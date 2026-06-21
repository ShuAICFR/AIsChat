"""
联邦连接管理器（v0.3.0 跨实例联邦通信）

管理与其他 AIsChat 实例的 WebSocket 直连，包括：
- 挑战-应答 HMAC 握手认证
- 消息转发（本地 → 远程，远程 → 本地）
- 心跳保活 + 指数退避重连
- 出站消息缓冲（断连时暂存，重连后重放）
"""
import asyncio
import json
import logging
from datetime import datetime, timezone
from dataclasses import dataclass, field
from collections import defaultdict

import websockets
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.federation import FederationGroupShare, FederationDMShare, FederationPeer
from app.services.federation_service import (
    get_peer_by_public_id,
    get_decrypted_secret,
    update_peer_connection_state,
    hmac_response,
    generate_challenge,
    handle_remote_message,
    get_connected_peers_for_group,
    get_instance_info,
    lookup_local_conversation_by_uuid,
    persist_remote_dm_message,
)

logger = logging.getLogger(__name__)

# 配置常量
HEARTBEAT_INTERVAL = 30  # 秒
HEARTBEAT_TIMEOUT = 60   # 秒（超过此时间无 pong 视为断连）
RECONNECT_BASE = 5       # 秒
RECONNECT_MAX = 300      # 秒（5 分钟上限）
RECONNECT_MULTIPLIER = 2
OUTBOX_MAX_SIZE = 1000


@dataclass
class PeerConnection:
    """单个对等端的连接状态"""
    websocket: "websockets.WebSocketClientProtocol | None" = None
    instance_id: str = ""               # 对方的子网 UUID
    public_id: str = ""                 # 对方的公网 ID
    display_name: str = ""
    remote_url: str = ""
    connected_at: "datetime | None" = None
    last_heartbeat: "datetime | None" = None
    pending_outbox: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=OUTBOX_MAX_SIZE))
    handshake_complete: bool = False
    # URL 动态轮换
    rotation_state: str | None = None       # None|proposing|received_proposal|trying_new|connected_new|reverted_old
    rotation_id: str | None = None          # 当前轮换的 ULID
    new_url: str | None = None              # 提议的新 URL
    last_rotation_at: "datetime | None" = None  # 上次轮换时间（用于频率限制）


class FederationManager:
    """
    联邦连接管理器（单例）

    管理所有出站 WebSocket 连接到远程对等端。
    入站连接由 routers/federation_ws.py 处理。
    """

    def __init__(self):
        self.peers: dict[str, PeerConnection] = {}       # peer_public_id → PeerConnection
        self.group_routes: dict[int, set[str]] = defaultdict(set)  # local_group_id → {peer_public_id}
        self._connecting: set[str] = set()               # 防重入：正在连接中的 public_id
        self._recent_rotation_ids: dict[str, set[str]] = defaultdict(set)  # 防重放：peer → {rotation_id}
        self._connecting_new_url: set[str] = set()       # 防重入：正在测试新 URL 的 public_id
        self._last_errors: dict[str, str] = {}           # public_id → 最后一次失败原因（公开）
        self._heartbeat_task: asyncio.Task | None = None
        self._reconnect_task: asyncio.Task | None = None
        self._running = False

    # ── 连接管理 ──

    async def connect_to_peer(self, peer_record) -> bool:
        """
        尝试连接到指定对等端。
        peer_record: FederationPeer ORM 对象（已含 encrypted secret）。
        返回 True 表示连接 + 握手成功。
        """
        public_id = peer_record.peer_public_id
        url = peer_record.remote_url

        # 防重入：同一 peer 正在连接中则跳过
        if public_id in self._connecting:
            logger.info(f"🌐 {public_id} 正在连接中，跳过重复请求")
            return False
        self._connecting.add(public_id)

        # 如果已有连接，先断开
        if public_id in self.peers:
            await self._close_peer_connection(public_id)

        try:
            secret = await get_decrypted_secret(peer_record)
        except Exception as e:
            logger.error(f"🌐 解密对等端 {public_id} 共享密钥失败: {e}")
            self._last_errors[public_id] = f"密钥解密失败：共享密钥可能不匹配或已损坏"
            self._connecting.discard(public_id)
            return False

        conn = PeerConnection(
            public_id=public_id,
            display_name=peer_record.display_name or "",
            remote_url=url,
        )
        self.peers[public_id] = conn

        try:
            async with async_session() as db:
                await update_peer_connection_state(db, peer_record.id, "connecting")
        except Exception:
            pass

        try:
            # 建立 WebSocket 连接
            ws = await websockets.connect(
                url,
                ping_interval=None,      # 我们自己管理心跳
                ping_timeout=None,
                close_timeout=10,
                max_size=2**20,          # 1MB 上限
            )
            conn.websocket = ws

            # ── 握手 ──
            my_challenge = generate_challenge()
            handshake_msg = {
                "type": "handshake",
                "public_id": await self._get_my_public_id(),
                "challenge": my_challenge,
            }
            await ws.send(json.dumps(handshake_msg))

            # 等待 handshake_ack
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=15)
                ack = json.loads(raw)
            except (asyncio.TimeoutError, json.JSONDecodeError) as e:
                msg = "握手超时（对方未在 15s 内响应）" if isinstance(e, asyncio.TimeoutError) else "握手响应格式无效（非 JSON）"
                logger.warning(f"🌐 握手超时/无效: {public_id} — {e}")
                self._last_errors[public_id] = msg
                await self._close_peer_connection(public_id)
                return False

            if ack.get("type") != "handshake_ack":
                logger.warning(f"🌐 握手阶段收到非预期消息: {ack.get('type')} from {public_id}")
                self._last_errors[public_id] = f"握手阶段收到非预期响应类型: {ack.get('type')}（预期 handshake_ack）"
                await self._close_peer_connection(public_id)
                return False

            # 验证对方对我方挑战的应答
            expected_response = hmac_response(secret, my_challenge)
            if ack.get("response") != expected_response:
                logger.warning(f"🌐 HMAC 验证失败: {public_id}（共享密钥不匹配）")
                self._last_errors[public_id] = "HMAC 验证失败：共享密钥不匹配（请确认双方共享密钥一致）"
                await self._close_peer_connection(public_id)
                return False

            # 发送 handshake_finish（回应对方的挑战）
            their_challenge = ack.get("challenge", "")
            finish_msg = {
                "type": "handshake_finish",
                "response": hmac_response(secret, their_challenge),
            }
            await ws.send(json.dumps(finish_msg))

            # 等待 handshake_ok
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=10)
                ok = json.loads(raw)
            except (asyncio.TimeoutError, json.JSONDecodeError) as e:
                msg = "握手确认超时（对方未在 10s 内确认）" if isinstance(e, asyncio.TimeoutError) else "握手确认响应格式无效"
                logger.warning(f"🌐 握手完成超时: {public_id} — {e}")
                self._last_errors[public_id] = msg
                await self._close_peer_connection(public_id)
                return False

            if ok.get("type") != "handshake_ok":
                logger.warning(f"🌐 握手未获确认: {public_id}")
                self._last_errors[public_id] = f"握手未获对方确认（收到 {ok.get('type')} 而非 handshake_ok）"
                await self._close_peer_connection(public_id)
                return False

            # ── 握手成功 ──
            conn.handshake_complete = True
            conn.connected_at = datetime.now(timezone.utc).replace(tzinfo=None)
            conn.last_heartbeat = conn.connected_at
            conn.instance_id = ack.get("instance_id", "")

            async with async_session() as db:
                await update_peer_connection_state(db, peer_record.id, "connected")

            # 重建 group_routes（从 DB 加载共享关系）
            await self._rebuild_group_routes()

            # 启动消息接收协程
            asyncio.create_task(self._receive_loop(public_id))

            # 重放出站缓冲
            await self._flush_outbox(public_id)

            logger.info(f"🌐 ✅ 已连接到 {public_id} ({conn.display_name})")
            return True

        except Exception as e:
            # 分类异常类型提供有意义的错误信息
            error_type = type(e).__name__
            error_msg = str(e) or error_type
            if "TLS" in error_type or "ssl" in error_msg.lower() or "SSL" in error_msg:
                detail = f"TLS/SSL 错误：{error_msg}"
            elif error_type == "InvalidURI" or "invalid" in error_msg.lower():
                detail = f"URL 格式无效：{error_msg}"
            elif "ConnectionRefusedError" in error_type or "refused" in error_msg.lower():
                detail = f"连接被拒绝（目标未运行或端口错误）：{error_msg}"
            elif "gaierror" in error_type.lower() or "getaddrinfo" in error_msg.lower() or "nodename" in error_msg.lower():
                detail = f"DNS 解析失败（域名/主机名不存在）：{error_msg}"
            elif error_type == "TimeoutError" or "timeout" in error_msg.lower():
                detail = f"连接超时：{error_msg}"
            elif "403" in error_msg:
                detail = f"握手被拒绝 (403)：（公开 ID 或共享密钥不匹配）：{error_msg}"
            elif "404" in error_msg:
                detail = f"联邦端点不存在 (404)：（路径错误或服务未启动）：{error_msg}"
            elif "400" in error_msg:
                detail = f"握手请求被拒绝 (400)：（公开 ID 或共享密钥不匹配）：{error_msg}"
            else:
                detail = f"{error_type}：{error_msg}"
            logger.warning(f"🌐 连接失败 {public_id}: {detail}")
            self._last_errors[public_id] = detail
            await self._close_peer_connection(public_id)
            try:
                async with async_session() as db:
                    await update_peer_connection_state(db, peer_record.id, "failed")
            except Exception:
                pass
            return False
        finally:
            self._connecting.discard(public_id)

    def get_last_error(self, public_id: str) -> str | None:
        """获取指定对等端最后一次连接失败的原因"""
        return self._last_errors.get(public_id)

    async def disconnect_peer(self, public_id: str) -> None:
        """断开与指定对等端的连接"""
        await self._close_peer_connection(public_id)
        async with async_session() as db:
            peer = await get_peer_by_public_id(db, public_id)
            if peer:
                await update_peer_connection_state(db, peer.id, "disconnected")
        logger.info(f"🌐 已断开 {public_id}")

    async def connect_all_enabled_peers(self) -> None:
        """启动时连接所有已启用的对等端"""
        from app.models.federation import FederationPeer

        async with async_session() as db:
            result = await db.execute(
                select(FederationPeer).where(
                    FederationPeer.is_enabled == True
                )
            )
            peers = result.scalars().all()

        for peer in peers:
            asyncio.create_task(self.connect_to_peer(peer))

        if peers:
            logger.info(f"🌐 正在连接 {len(peers)} 个对等端...")
        else:
            logger.info("🌐 无已启用对等端")

    async def disconnect_all(self) -> None:
        """关闭时断开所有连接"""
        for public_id in list(self.peers.keys()):
            await self._close_peer_connection(public_id)
        logger.info("🌐 所有对等端连接已关闭")

    # ── 消息转发 ──

    async def forward_message(
        self,
        group_id: int,
        message_dict: dict,
        exclude_public_id: str | None = None,
    ) -> None:
        """
        将消息转发给共享此群的所有已连接对等端。
        exclude_public_id: 排除的来源实例（防止回环）。
        """
        peer_ids = self.group_routes.get(group_id, set())
        if not peer_ids:
            return

        # Look up conversation UUID for this group
        conversation_uuid = None
        async with async_session() as db:
            result = await db.execute(
                select(FederationGroupShare.conversation_uuid).where(
                    FederationGroupShare.group_id == group_id,
                    FederationGroupShare.is_enabled == True,
                ).limit(1)
            )
            row = result.first()
            conversation_uuid = row[0] if row else None

        payload = {
            "type": "forward_message",
            "conversation_type": "group",
            "group_id": group_id,
            "conversation_uuid": conversation_uuid,
            "message": message_dict,
            "source_public_id": await self._get_my_public_id(),
        }

        for pid in peer_ids:
            if pid == exclude_public_id:
                continue  # 不回传给来源
            conn = self.peers.get(pid)
            if conn and conn.handshake_complete and conn.websocket:
                try:
                    await conn.websocket.send(json.dumps(payload))
                except Exception as e:
                    logger.warning(f"🌐 转发消息到 {pid} 失败: {e}")
                    # 放入出站缓冲
                    try:
                        conn.pending_outbox.put_nowait(payload)
                    except asyncio.QueueFull:
                        logger.warning(f"🌐 {pid} 出站缓冲已满，丢弃消息")
            else:
                # 未连接，缓冲
                try:
                    conn.pending_outbox.put_nowait(payload) if conn else None
                except (asyncio.QueueFull, AttributeError):
                    pass

    async def forward_dm_message(
        self,
        session_id: str,
        message_dict: dict,
        exclude_public_id: str | None = None,
    ) -> None:
        """Forward a DM message to all connected peers that share this DM."""
        async with async_session() as db:
            result = await db.execute(
                select(FederationDMShare, FederationPeer.peer_public_id).join(
                    FederationPeer, FederationDMShare.peer_id == FederationPeer.id
                ).where(
                    FederationDMShare.session_id == session_id,
                    FederationDMShare.is_enabled == True,
                )
            )
            rows = result.all()
            if not rows:
                return

            for share, peer_pid in rows:
                if peer_pid == exclude_public_id:
                    continue
                conn = self.peers.get(peer_pid)
                payload = {
                    "type": "forward_message",
                    "conversation_type": "dm",
                    "session_id": session_id,
                    "conversation_uuid": share.conversation_uuid,
                    "message": message_dict,
                    "source_public_id": await self._get_my_public_id(),
                }
                if conn and conn.handshake_complete and conn.websocket:
                    try:
                        await conn.websocket.send(json.dumps(payload))
                    except Exception as e:
                        logger.warning(f"Forward DM to {peer_pid} failed: {e}")
                        try:
                            conn.pending_outbox.put_nowait(payload)
                        except asyncio.QueueFull:
                            pass

    async def send_to_peer(self, public_id: str, payload: dict) -> bool:
        """向指定对等端发送消息"""
        conn = self.peers.get(public_id)
        if not conn or not conn.websocket or not conn.handshake_complete:
            return False
        try:
            await conn.websocket.send(json.dumps(payload))
            return True
        except Exception:
            return False

    # ── 后台任务 ──

    async def heartbeat_loop(self) -> None:
        """30 秒心跳循环"""
        self._running = True
        while self._running:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            now = datetime.now(timezone.utc).replace(tzinfo=None)

            for public_id, conn in list(self.peers.items()):
                if not conn.handshake_complete or not conn.websocket:
                    continue

                # 检查超时
                if conn.last_heartbeat:
                    age = (now - conn.last_heartbeat).total_seconds()
                    if age > HEARTBEAT_TIMEOUT:
                        logger.warning(f"🌐 {public_id} 心跳超时 ({age:.0f}s)，断开")
                        await self._close_peer_connection(public_id)
                        continue

                # 发送 ping
                try:
                    await conn.websocket.send(json.dumps({"type": "ping"}))
                except Exception:
                    logger.warning(f"🌐 {public_id} ping 失败，断开")
                    await self._close_peer_connection(public_id)

    async def reconnect_loop(self) -> None:
        """指数退避重连循环"""
        from app.models.federation import FederationPeer

        fail_counts: dict[str, int] = defaultdict(int)

        while self._running:
            await asyncio.sleep(RECONNECT_BASE)

            async with async_session() as db:
                result = await db.execute(
                    select(FederationPeer).where(
                        FederationPeer.is_enabled == True,
                        FederationPeer.connection_state.in_(["disconnected", "failed"]),
                    )
                )
                disconnected = result.scalars().all()

            for peer in disconnected:
                pid = peer.peer_public_id
                if pid in self.peers and self.peers[pid].handshake_complete:
                    continue  # 已连接

                # 指数退避
                fails = fail_counts.get(pid, 0)
                delay = min(RECONNECT_BASE * (RECONNECT_MULTIPLIER ** fails), RECONNECT_MAX)
                await asyncio.sleep(delay)

                logger.info(f"🌐 尝试重连 {pid} (第 {fails + 1} 次, 延迟 {delay}s)")
                success = await self.connect_to_peer(peer)
                if success:
                    fail_counts[pid] = 0
                else:
                    fail_counts[pid] = fails + 1

    # ── 内部方法 ──

    async def _receive_loop(self, public_id: str) -> None:
        """接收来自指定对等端的消息"""
        conn = self.peers.get(public_id)
        if not conn or not conn.websocket:
            return

        try:
            async for raw in conn.websocket:
                conn.last_heartbeat = datetime.now(timezone.utc).replace(tzinfo=None)
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning(f"🌐 {public_id} 发来无效 JSON")
                    continue

                msg_type = data.get("type", "")
                if msg_type == "pong":
                    pass  # 心跳回复，已更新 last_heartbeat
                elif msg_type == "ping":
                    try:
                        await conn.websocket.send(json.dumps({"type": "pong"}))
                    except Exception:
                        pass
                elif msg_type == "forward_message":
                    await self._handle_remote_forward(public_id, data)
                elif msg_type == "conversation_announce":
                    await self._handle_conversation_announce(public_id, data)
                elif msg_type == "conversation_ack":
                    await self._handle_conversation_ack(public_id, data)
                elif msg_type == "error":
                    logger.warning(f"🌐 {public_id} 报错: {data.get('code')} — {data.get('message')}")
                elif msg_type == "url_rotate_propose":
                    await self._handle_url_rotate_propose(public_id, data)
                elif msg_type == "url_rotate_ack":
                    await self._handle_url_rotate_ack(public_id, data)
                elif msg_type == "url_rotate_commit":
                    await self._handle_url_rotate_commit(public_id, data)
                else:
                    logger.debug(f"🌐 未知消息类型: {msg_type} from {public_id}")
        except Exception as e:
            logger.warning(f"🌐 {public_id} 接收循环异常: {e}")
        finally:
            await self._close_peer_connection(public_id)

    async def _handle_remote_forward(self, from_public_id: str, data: dict) -> None:
        """处理远程转发来的消息"""
        conversation_uuid = data.get("conversation_uuid")
        conversation_type = data.get("conversation_type", "group")
        msg = data.get("message", {})
        source_public_id = data.get("source_public_id", from_public_id)

        if not msg:
            return

        group_id = None
        session_id = None

        # Resolve conversation UUID
        if conversation_uuid:
            async with async_session() as db:
                mapping = await lookup_local_conversation_by_uuid(db, from_public_id, conversation_uuid)
                if mapping is None:
                    logger.warning(f"Unknown conversation_uuid {conversation_uuid} from {from_public_id}")
                    # Send error back
                    conn = self.peers.get(from_public_id)
                    if conn and conn.handshake_complete and conn.websocket:
                        try:
                            await conn.websocket.send(json.dumps({
                                "type": "error",
                                "code": "UNKNOWN_CONVERSATION",
                                "conversation_uuid": conversation_uuid,
                            }))
                        except Exception:
                            pass
                    return
                if mapping["type"] == "group":
                    group_id = mapping["local_id"]
                    conversation_type = "group"
                else:
                    session_id = mapping["local_id"]
                    conversation_type = "dm"
        else:
            # Backwards compat: use raw group_id
            group_id = data.get("group_id")
            if not group_id:
                session_id = data.get("session_id")
                conversation_type = "dm" if session_id else "group"

        try:
            if conversation_type == "group" and group_id:
                async with async_session() as db:
                    message = await handle_remote_message(
                        db, int(group_id), msg, source_public_id
                    )
                    await db.commit()

                    from app.services.group_service import message_to_dict
                    msg_data = message_to_dict(message, sender_name=msg.get("sender_name", "Remote User"))

                    from app.routers.ws import manager
                    await manager.broadcast_to_group(
                        int(group_id),
                        {"type": "message", "conversation_type": "group", "data": msg_data},
                    )

                    if msg.get("sender_type") == "human":
                        from app.services.ai_response_worker import message_queue
                        try:
                            message_queue.put_nowait({
                                "conversation_type": "group",
                                "group_id": int(group_id),
                                "message_id": message.id,
                                "content": msg.get("content", ""),
                                "sender_type": "human",
                                "sender_id": 0,
                                "chain_depth": 0,
                                "source_public_id": source_public_id,
                            })
                        except asyncio.QueueFull:
                            pass
            elif conversation_type == "dm" and session_id:
                async with async_session() as db:
                    dm_msg = await persist_remote_dm_message(db, str(session_id), msg, source_public_id)
                    await db.commit()
                    from app.routers.ws import manager
                    dm_data = {
                        "id": dm_msg.id if hasattr(dm_msg, 'id') else None,
                        "session_id": str(session_id),
                        "sender_id": 0,
                        "sender_name": msg.get("sender_name", "Remote User"),
                        "sender_type": msg.get("sender_type", "human"),
                        "content": msg.get("content", ""),
                        "reply_to": msg.get("reply_to"),
                        "source_public_id": source_public_id,
                        "created_at": str(dm_msg.created_at) if hasattr(dm_msg, 'created_at') else None,
                        "read_at": None,
                    }
                    await manager.broadcast_to_dm(
                        str(session_id),
                        {"type": "message", "conversation_type": "dm", "data": dm_data},
                    )
        except Exception as e:
            logger.error(f"Handle remote forward error: {e}")

    async def _handle_conversation_announce(self, from_public_id: str, data: dict) -> None:
        """Handle incoming conversation UUID announcement"""
        conversation_uuid = data.get("conversation_uuid")
        conversation_type = data.get("conversation_type", "group")
        remote_local_id = data.get("local_id")
        share_direction = data.get("share_direction", "bidirectional")

        if not conversation_uuid:
            return

        # Mirror the direction
        mirror_direction = share_direction
        if share_direction == "outgoing":
            mirror_direction = "incoming"
        elif share_direction == "incoming":
            mirror_direction = "outgoing"

        async with async_session() as db:
            peer = await get_peer_by_public_id(db, from_public_id)
            if not peer:
                logger.warning(f"Announce from unknown peer {from_public_id}")
                return

            if conversation_type == "group":
                # If we already have a share with this peer, update remote_group_id
                result = await db.execute(
                    select(FederationGroupShare).where(
                        FederationGroupShare.conversation_uuid == conversation_uuid,
                        FederationGroupShare.peer_id == peer.id,
                    )
                )
                share = result.scalar_one_or_none()
                if share:
                    share.remote_group_id = remote_local_id
                    await db.commit()
            # Send ack
            conn = self.peers.get(from_public_id)
            if conn and conn.handshake_complete and conn.websocket:
                try:
                    await conn.websocket.send(json.dumps({
                        "type": "conversation_ack",
                        "conversation_uuid": conversation_uuid,
                        "accepted": True,
                    }))
                except Exception:
                    pass

    async def _handle_conversation_ack(self, from_public_id: str, data: dict) -> None:
        """Handle conversation ack, update remote_group_id"""
        conversation_uuid = data.get("conversation_uuid")
        remote_local_id = data.get("local_id")
        if not conversation_uuid:
            return
        if remote_local_id:
            async with async_session() as db:
                result = await db.execute(
                    select(FederationGroupShare).where(
                        FederationGroupShare.conversation_uuid == conversation_uuid,
                    )
                )
                share = result.scalar_one_or_none()
                if share:
                    share.remote_group_id = remote_local_id
                    await db.commit()

    # ── URL 动态轮换 ──

    async def initiate_url_rotation(self, public_id: str, new_url: str) -> str | None:
        """
        发起 URL 轮换。返回 None 表示成功发起，返回字符串表示错误消息。
        仅已连接且未在轮换中的 peer 可发起。
        """
        conn = self.peers.get(public_id)
        if not conn or not conn.handshake_complete:
            return "对等端未连接，无法发起轮换"
        if conn.rotation_state is not None:
            return f"对等端正在轮换中（{conn.rotation_state}），请稍后再试"

        from datetime import timedelta

        # 频率限制：最少间隔 300 秒
        MIN_INTERVAL = timedelta(seconds=300)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if conn.last_rotation_at and (now - conn.last_rotation_at) < MIN_INTERVAL:
            remaining = int(MIN_INTERVAL.total_seconds() - (now - conn.last_rotation_at).total_seconds())
            return f"距上次轮换不足 {remaining} 秒，请等待"

        # 验证 URL
        from app.services.federation_service import validate_rotation_url
        err = validate_rotation_url(new_url, conn.remote_url)
        if err:
            return err

        # 生成 rotation_id
        import uuid
        rotation_id = uuid.uuid4().hex[:16]  # 32 字符 hex
        expires_at = (now + timedelta(seconds=60)).isoformat()

        # 获取共享密钥
        async with async_session() as db:
            peer = await get_peer_by_public_id(db, public_id)
            if not peer:
                return "对等端不存在"
            secret = await get_decrypted_secret(peer)

        # 计算 HMAC
        from app.services.federation_service import url_rotate_hmac
        hmac_val = url_rotate_hmac(secret, rotation_id, new_url, expires_at, "propose")

        # 更新连接状态
        conn.rotation_state = "proposing"
        conn.rotation_id = rotation_id
        conn.new_url = new_url
        conn.last_rotation_at = now

        # 发送提议
        try:
            await conn.websocket.send(json.dumps({
                "type": "url_rotate_propose",
                "rotation_id": rotation_id,
                "new_url": new_url,
                "expires_at": expires_at,
                "hmac": hmac_val,
            }))
        except Exception:
            conn.rotation_state = None
            conn.rotation_id = None
            conn.new_url = None
            return "发送轮换提议失败"

        logger.info(f"🌐 发起 URL 轮换: {public_id} → {new_url}")
        return None

    async def _handle_url_rotate_propose(self, public_id: str, data: dict) -> None:
        """处理对方发来的 URL 轮换提议"""
        conn = self.peers.get(public_id)
        if not conn or not conn.handshake_complete:
            return

        rotation_id = data.get("rotation_id", "")
        new_url = data.get("new_url", "")
        expires_at_str = data.get("expires_at", "")
        hmac_val = data.get("hmac", "")

        # 防重放
        if rotation_id in self._recent_rotation_ids.get(public_id, set()):
            logger.warning(f"🌐 重复的 rotation_id: {rotation_id} from {public_id}")
            return
        self._recent_rotation_ids[public_id].add(rotation_id)
        # 限制集合大小
        if len(self._recent_rotation_ids[public_id]) > 100:
            self._recent_rotation_ids[public_id] = set(list(self._recent_rotation_ids[public_id])[-50:])

        # 检查过期
        from datetime import timedelta
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        try:
            expires_at = datetime.fromisoformat(expires_at_str)
            if now > expires_at:
                logger.info(f"🌐 URL 轮换提议已过期: {rotation_id} from {public_id}")
                await self._send_rotation_msg(public_id, "url_rotate_ack", rotation_id, False)
                return
        except (ValueError, TypeError):
            await self._send_rotation_msg(public_id, "url_rotate_ack", rotation_id, False)
            return

        # 频率限制检查
        MIN_INTERVAL = timedelta(seconds=300)
        if conn.last_rotation_at and (now - conn.last_rotation_at) < MIN_INTERVAL:
            logger.info(f"🌐 轮换过于频繁 from {public_id}")
            await self._send_rotation_msg(public_id, "url_rotate_ack", rotation_id, False)
            return

        # 检查是否已在轮换中
        if conn.rotation_state is not None:
            await self._send_rotation_msg(public_id, "url_rotate_ack", rotation_id, False)
            return

        # 先查 DB（需要 peer 的 remote_url 和 secret）
        async with async_session() as db:
            peer = await get_peer_by_public_id(db, public_id)
            if not peer:
                return
            secret = await get_decrypted_secret(peer)
            current_url = peer.remote_url

        # 验证 URL（用 DB 中的 remote_url 而非 conn）
        from app.services.federation_service import validate_rotation_url
        err = validate_rotation_url(new_url, current_url)
        if err:
            logger.info(f"🌐 轮换 URL 不合法 from {public_id}: {err}")
            await self._send_rotation_msg(public_id, "url_rotate_ack", rotation_id, False)
            return

        from app.services.federation_service import url_rotate_hmac
        expected_hmac = url_rotate_hmac(secret, rotation_id, new_url, expires_at_str, "propose")
        if hmac_val != expected_hmac:
            logger.warning(f"🌐 轮换提议 HMAC 不匹配 from {public_id}")
            await self._send_rotation_msg(public_id, "url_rotate_ack", rotation_id, False)
            return

        # 接受提议
        conn.rotation_state = "received_proposal"
        conn.rotation_id = rotation_id
        conn.new_url = new_url
        conn.last_rotation_at = now

        # 发送 ack
        await self._send_rotation_msg(public_id, "url_rotate_ack", rotation_id, True)

        # 异步测试新 URL
        asyncio.create_task(self._test_new_url_connection(public_id, new_url, rotation_id))

    async def _handle_url_rotate_ack(self, public_id: str, data: dict) -> None:
        """处理对方对轮换提议的确认"""
        conn = self.peers.get(public_id)
        if not conn:
            return

        rotation_id = data.get("rotation_id", "")
        accepted = data.get("accepted", False)

        if conn.rotation_state != "proposing" or conn.rotation_id != rotation_id:
            return  # 不是我们发出的提议

        if not accepted:
            logger.info(f"🌐 {public_id} 拒绝了 URL 轮换提议")
            conn.rotation_state = None
            conn.rotation_id = None
            conn.new_url = None
            return

        logger.info(f"🌐 {public_id} 接受了 URL 轮换，开始测试新 URL")
        conn.rotation_state = "trying_new"
        asyncio.create_task(self._test_new_url_connection(public_id, conn.new_url, rotation_id))

    async def _handle_url_rotate_commit(self, public_id: str, data: dict) -> None:
        """处理轮换提交/回退"""
        conn = self.peers.get(public_id)
        if not conn:
            return

        rotation_id = data.get("rotation_id", "")
        result = data.get("result", "rollback")

        # 只处理与当前轮换匹配的 commit
        if conn.rotation_id != rotation_id:
            return

        await self._commit_rotation(public_id, rotation_id, result == "success")

    async def _test_new_url_connection(self, public_id: str, url: str, rotation_id: str) -> None:
        """测试新 URL 的 WebSocket 握手（非阻塞）"""
        conn = self.peers.get(public_id)
        if not conn:
            return

        # 防重入
        test_key = f"{public_id}:{rotation_id}"
        if test_key in self._connecting_new_url:
            return
        self._connecting_new_url.add(test_key)

        success = False
        try:
            logger.info(f"🌐 测试新 URL 连接: {public_id} → {url}")
            test_ws = await asyncio.wait_for(
                websockets.connect(url, ping_interval=None, ping_timeout=None, close_timeout=10, max_size=2**20),
                timeout=15,
            )

            try:
                # 简单握手验证
                challenge = generate_challenge()
                my_pub_id = await self._get_my_public_id()
                await test_ws.send(json.dumps({
                    "type": "handshake",
                    "public_id": my_pub_id,
                    "challenge": challenge,
                }))

                raw = await asyncio.wait_for(test_ws.recv(), timeout=10)
                ack = json.loads(raw)
                if ack.get("type") == "handshake_ack":
                    success = True
                    logger.info(f"🌐 新 URL 测试握手成功: {public_id}")
            finally:
                try:
                    await test_ws.close()
                except Exception:
                    pass

        except Exception as e:
            logger.warning(f"🌐 新 URL 测试失败: {public_id} — {e}")

        finally:
            self._connecting_new_url.discard(test_key)

        # 更新状态并发送 commit
        if conn.rotation_id != rotation_id:
            return  # 轮换已被取消

        if success:
            conn.rotation_state = "connected_new"
            await self._send_rotation_msg(public_id, "url_rotate_commit", rotation_id, True, "success")
        else:
            conn.rotation_state = "reverted_old"
            await self._send_rotation_msg(public_id, "url_rotate_commit", rotation_id, True, "rollback")

    async def _commit_rotation(self, public_id: str, rotation_id: str, success: bool) -> None:
        """提交或回退 URL 轮换"""
        conn = self.peers.get(public_id)
        if not conn:
            return

        if success and conn.new_url:
            # 更新数据库
            async with async_session() as db:
                peer = await get_peer_by_public_id(db, public_id)
                if peer:
                    from app.services.federation_service import update_peer_url
                    await update_peer_url(db, peer.id, conn.new_url)
            # 更新内存中的 URL
            conn.remote_url = conn.new_url
            logger.info(f"🌐 ✅ URL 轮换成功: {public_id} → {conn.new_url}")
        else:
            logger.info(f"🌐 ↩️ URL 轮换回退: {public_id} 保持 {conn.remote_url}")

        # 清理状态
        conn.rotation_state = None
        conn.rotation_id = None
        conn.new_url = None

    async def _abort_rotation(self, public_id: str) -> None:
        """异常情况下中止轮换（不修改 DB）"""
        conn = self.peers.get(public_id)
        if conn and conn.rotation_state is not None:
            logger.warning(f"🌐 中止轮换: {public_id} (状态={conn.rotation_state})")
            conn.rotation_state = None
            conn.rotation_id = None
            conn.new_url = None

    async def _send_rotation_msg(
        self, public_id: str, msg_type: str, rotation_id: str,
        accepted: bool = False, result: str = "",
    ) -> None:
        """发送 URL 轮换相关消息"""
        conn = self.peers.get(public_id)
        if not conn or not conn.websocket or not conn.handshake_complete:
            return

        payload = {"type": msg_type, "rotation_id": rotation_id}

        if msg_type == "url_rotate_ack":
            payload["accepted"] = accepted
        elif msg_type == "url_rotate_commit":
            payload["result"] = result

        # 添加 HMAC
        async with async_session() as db:
            peer = await get_peer_by_public_id(db, public_id)
            if peer:
                secret = await get_decrypted_secret(peer)
                from app.services.federation_service import url_rotate_hmac
                fields = [str(accepted).lower(), result, msg_type.split("_")[-1]]
                payload["hmac"] = url_rotate_hmac(secret, rotation_id, *fields)

        try:
            await conn.websocket.send(json.dumps(payload))
        except Exception:
            pass

    async def handle_inbound_rotation_message(
        self, public_id: str, data: dict, inbound_ws=None
    ) -> None:
        """federation_ws.py 调用：处理入站连接上的轮换消息"""
        msg_type = data.get("type", "")

        # 如果是入站连接（无出站 PeerConnection），创建临时条目以便发送消息
        is_inbound = public_id not in self.peers or not self.peers[public_id].handshake_complete
        if is_inbound and inbound_ws:
            # 创建/更新一个临时 PeerConnection 仅用于轮换消息发送
            if public_id not in self.peers:
                self.peers[public_id] = PeerConnection(
                    public_id=public_id,
                    websocket=inbound_ws,
                    handshake_complete=True,
                    remote_url="",  # 入站连接不追踪 URL
                )

        if msg_type == "url_rotate_propose":
            await self._handle_url_rotate_propose(public_id, data)
        elif msg_type == "url_rotate_ack":
            await self._handle_url_rotate_ack(public_id, data)
        elif msg_type == "url_rotate_commit":
            await self._handle_url_rotate_commit(public_id, data)

    async def _close_peer_connection(self, public_id: str) -> None:
        """关闭与指定对等端的连接（不清除缓冲）"""
        conn = self.peers.get(public_id)
        if conn is None:
            return

        # 如果正在轮换中，中止（重连会恢复旧 URL）
        if conn.rotation_state is not None:
            await self._abort_rotation(public_id)

        conn.handshake_complete = False
        if conn.websocket:
            try:
                await conn.websocket.close()
            except Exception:
                pass
            conn.websocket = None

        logger.info(f"🌐 关闭连接: {public_id}")

    async def _flush_outbox(self, public_id: str) -> None:
        """重放出站缓冲中积压的消息"""
        conn = self.peers.get(public_id)
        if not conn or not conn.websocket or not conn.handshake_complete:
            return

        flushed = 0
        while not conn.pending_outbox.empty():
            try:
                payload = conn.pending_outbox.get_nowait()
                await conn.websocket.send(json.dumps(payload))
                flushed += 1
            except asyncio.QueueEmpty:
                break
            except Exception:
                break

        if flushed:
            logger.info(f"🌐 {public_id} 缓冲重放: {flushed} 条消息")

    async def _rebuild_group_routes(self) -> None:
        """从数据库重建 group_routes 映射"""
        from app.models.federation import FederationGroupShare, FederationPeer

        self.group_routes.clear()
        async with async_session() as db:
            result = await db.execute(
                select(
                    FederationGroupShare.group_id, FederationPeer.peer_public_id
                )
                .join(FederationPeer, FederationGroupShare.peer_id == FederationPeer.id)
                .where(
                    FederationGroupShare.is_enabled == True,
                    FederationPeer.is_enabled == True,
                    FederationPeer.peer_public_id.in_(  # 仅已连接的
                        [pid for pid, c in self.peers.items() if c.handshake_complete]
                    ),
                )
            )
            for group_id, peer_public_id in result.all():
                self.group_routes[group_id].add(peer_public_id)

    async def _get_my_public_id(self) -> str:
        """获取本实例的公网 ID"""
        async with async_session() as db:
            info = await get_instance_info(db)
            return info.get("public_id", "") or ""


# ── 全局单例 ──

federation_manager = FederationManager()


async def federation_heartbeat():
    """后台心跳任务（供 main.py lifespan 调用）"""
    await federation_manager.heartbeat_loop()


async def federation_reconnect():
    """后台重连任务（供 main.py lifespan 调用）"""
    await federation_manager.reconnect_loop()
