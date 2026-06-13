"""
WebSocket 实时通信处理器
支持 DND 过滤、消息暂存、错误推送
"""
import asyncio
import json
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy import select
from app.database import async_session
from app.models.agent import Agent as AgentModel
from app.models.group import GroupMember as GroupMemberModel
from app.utils.auth import decode_access_token
from app.utils.error_handler import build_ws_error, log_error
from app.services.group_service import (
    create_message, message_to_dict, store_pending_message,
)

logger = logging.getLogger(__name__)

router = APIRouter()


class ConnectionManager:
    """WebSocket 连接管理器（支持 DND 过滤和错误推送）"""

    def __init__(self):
        # {group_id: {user_id: websocket}}
        self.group_connections: dict[int, dict[int, WebSocket]] = {}
        # {user_id: websocket} 用于私信/错误通知
        self.user_connections: dict[int, WebSocket] = {}

    async def connect(self, ws: WebSocket, group_id: int, user_id: int):
        if group_id not in self.group_connections:
            self.group_connections[group_id] = {}
        self.group_connections[group_id][user_id] = ws
        self.user_connections[user_id] = ws
        logger.info(f"用户 {user_id} 加入群聊 {group_id} 的 WebSocket")

    def disconnect(self, group_id: int, user_id: int):
        if group_id in self.group_connections:
            self.group_connections[group_id].pop(user_id, None)
            if not self.group_connections[group_id]:
                del self.group_connections[group_id]
        self.user_connections.pop(user_id, None)
        logger.info(f"用户 {user_id} 离开群聊 {group_id} 的 WebSocket")

    async def broadcast_to_group(
        self,
        group_id: int,
        message: dict,
        exclude_user_id: int | None = None,
    ):
        """向群聊广播消息（排除发送者）"""
        if group_id in self.group_connections:
            for uid, ws in self.group_connections[group_id].items():
                if exclude_user_id is not None and uid == exclude_user_id:
                    continue
                try:
                    await ws.send_json(message)
                except Exception as e:
                    logger.warning(f"发送消息给用户 {uid} 失败: {e}")

    async def send_to_user(self, user_id: int, message: dict):
        """向特定用户发送消息（如错误通知、摘要）"""
        if user_id in self.user_connections:
            try:
                await self.user_connections[user_id].send_json(message)
            except Exception as e:
                logger.warning(f"发送消息给用户 {user_id} 失败: {e}")

    async def send_error(
        self,
        user_id: int,
        code: str,
        message: str,
        tool_call_id: str | None = None,
    ):
        """向特定用户发送 WebSocket 错误事件"""
        error_event = build_ws_error(code, message, tool_call_id)
        await self.send_to_user(user_id, error_event)

    def get_online_users(self, group_id: int) -> list[int]:
        if group_id in self.group_connections:
            return list(self.group_connections[group_id].keys())
        return []


manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = Query(...)):
    """WebSocket 端点：/ws?token=JWT"""

    payload = decode_access_token(token)
    if payload is None:
        await ws.close(code=4001, reason="令牌无效或已过期")
        return

    user_id = int(payload.get("user_id", 0))
    username = payload.get("username", "unknown")

    if user_id == 0:
        await ws.close(code=4001, reason="令牌数据不完整")
        return

    await ws.accept()
    current_group_id: int | None = None

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json(build_ws_error("INVALID_JSON", "无效的 JSON 格式"))
                continue

            msg_type = data.get("type", "")

            # ---- 订阅群聊 ----
            if msg_type == "subscribe":
                group_id = data.get("group_id")
                if group_id is None:
                    await ws.send_json(build_ws_error("MISSING_GROUP", "缺少 group_id"))
                    continue

                if current_group_id is not None:
                    manager.disconnect(current_group_id, user_id)

                current_group_id = group_id
                await manager.connect(ws, group_id, user_id)
                await ws.send_json({
                    "type": "subscribed",
                    "data": {"group_id": group_id},
                })

                await manager.broadcast_to_group(
                    group_id,
                    {"type": "user_online", "data": {"user_id": user_id, "username": username}},
                    exclude_user_id=user_id,
                )

            # ---- 发送消息 ----
            elif msg_type == "send":
                group_id = data.get("group_id", current_group_id)
                content = data.get("content", "")
                reply_to = data.get("reply_to")
                sender_type = data.get("sender_type", "human")  # 支持 AI 发送

                if not group_id or not content:
                    await ws.send_json(build_ws_error("MISSING_FIELD", "缺少 group_id 或 content"))
                    continue

                # 持久化消息 + 批量查 DND + 广播（复用同一 session）
                async with async_session() as db:
                    try:
                        message = await create_message(
                            db, group_id=group_id, sender_type=sender_type,
                            sender_id=user_id, content=content, reply_to=reply_to,
                        )
                        await db.flush()
                    except Exception as e:
                        logger.error(f"消息持久化失败: {e}")
                        await ws.send_json(build_ws_error("SEND_FAILED", "消息发送失败"))
                        continue

                    msg_data = message_to_dict(message, sender_name=username)

                    # 先回显给发送者
                    await ws.send_json({"type": "message", "data": msg_data})

                    # 收集在线成员 ID 列表
                    online_ids = [
                        uid for uid in manager.group_connections.get(group_id, {})
                        if uid != user_id
                    ]

                    if online_ids:
                        # 批量查询所有在线成员的 DND 状态（替代逐个 N+1 查询）
                        paused_result = await db.execute(
                            select(AgentModel.id).where(
                                AgentModel.id.in_(online_ids),
                                AgentModel.is_paused == True,
                            )
                        )
                        paused_ids = {row[0] for row in paused_result.all()}

                        now = datetime.utcnow()
                        dnd_result = await db.execute(
                            select(GroupMemberModel.member_id, GroupMemberModel.dnd_until).where(
                                GroupMemberModel.group_id == group_id,
                                GroupMemberModel.member_type == "ai",
                                GroupMemberModel.member_id.in_(online_ids),
                            )
                        )
                        dnd_map: dict[int, datetime | None] = {row[0]: row[1] for row in dnd_result.all()}

                        # 广播：DND 成员暂存消息，但 @提及 强制推送
                        # 先检测 @提及的 AI 名称（用于强制推送）
                        mentioned_agents = set()
                        for uid in online_ids:
                            # 从在线 AI 中检测是否被 @提及
                            agent_name_result = await db.execute(
                                select(AgentModel.name).where(AgentModel.id == uid)
                            )
                            agent_name = agent_name_result.scalar_one_or_none()
                            if agent_name and (
                                f"@{agent_name}" in content
                                or "@all" in content.lower()
                                or "@ai" in content.lower()
                            ):
                                mentioned_agents.add(uid)

                        for uid, user_ws in manager.group_connections[group_id].items():
                            if uid == user_id:
                                continue

                            in_dnd = (
                                uid in paused_ids
                                or (uid in dnd_map and (dnd_map[uid] is None or dnd_map[uid] > now))
                            )

                            # @提及强制推送（即使 DND 也推送）
                            if in_dnd and uid in mentioned_agents:
                                try:
                                    await user_ws.send_json({"type": "message", "data": msg_data})
                                except Exception as e:
                                    logger.warning(f"发送消息给用户 {uid} 失败: {e}")
                                continue

                            if in_dnd:
                                try:
                                    await store_pending_message(
                                        db, agent_id=uid, group_id=group_id,
                                        message_id=message.id,
                                    )
                                except Exception as e:
                                    logger.warning(f"暂存消息给 AI {uid} 失败: {e}")
                                continue

                            try:
                                await user_ws.send_json({"type": "message", "data": msg_data})
                            except Exception as e:
                                logger.warning(f"发送消息给用户 {uid} 失败: {e}")

                    # 持久化提交
                    await db.commit()

                    # 触发 AI 自动回复 worker（仅人类消息，始终触发不受在线用户数影响）
                    if sender_type == "human":
                        from app.services.ai_response_worker import message_queue
                        try:
                            message_queue.put_nowait({
                                "group_id": group_id,
                                "message_id": message.id,
                                "content": content,
                                "sender_type": sender_type,
                                "sender_id": user_id,
                            })
                            logger.info(f"📨 消息已推入 AI 队列: group={group_id}, msg={message.id}, queue_size={message_queue.qsize()}")
                        except asyncio.QueueFull:
                            logger.warning("AI 回复队列已满，丢弃事件")

                    # 触发向量化 pipeline（仅向量加速群聊）
                    from app.models.group import Group as GroupModel
                    group_check = await db.execute(
                        select(GroupModel.is_vector_accelerated).where(
                            GroupModel.id == group_id,
                        )
                    )
                    is_accelerated = group_check.scalar_one_or_none()
                    if is_accelerated:
                        from app.services.vector_pipeline import embedding_queue
                        try:
                            embedding_queue.put_nowait({
                                "group_id": group_id,
                                "message_id": message.id,
                            })
                        except asyncio.QueueFull:
                            pass  # 向量化队列满则丢弃，不影响主流程

            # ---- 输入状态 ----
            elif msg_type == "typing":
                group_id = data.get("group_id", current_group_id)
                is_typing = data.get("is_typing", False)
                if group_id:
                    await manager.broadcast_to_group(
                        group_id,
                        {
                            "type": "typing",
                            "data": {
                                "group_id": group_id,
                                "sender_id": user_id,
                                "username": username,
                                "is_typing": is_typing,
                            },
                        },
                        exclude_user_id=user_id,
                    )

            # ---- 未知类型 ----
            else:
                logger.debug(f"未知消息类型: {msg_type}")
                # 不报错，静默忽略（允许客户端扩展协议）

    except WebSocketDisconnect:
        logger.info(f"用户 {user_id} WebSocket 断开")
    finally:
        if current_group_id is not None:
            manager.disconnect(current_group_id, user_id)
            await manager.broadcast_to_group(
                current_group_id,
                {"type": "user_offline", "data": {"user_id": user_id, "username": username}},
            )
