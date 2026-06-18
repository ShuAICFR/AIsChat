"""
联邦连接管理器（v1.2.0 跨实例联邦通信）

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
from app.services.federation_service import (
    get_peer_by_public_id,
    get_decrypted_secret,
    update_peer_connection_state,
    hmac_response,
    generate_challenge,
    handle_remote_message,
    get_connected_peers_for_group,
    get_instance_info,
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


class FederationManager:
    """
    联邦连接管理器（单例）

    管理所有出站 WebSocket 连接到远程对等端。
    入站连接由 routers/federation_ws.py 处理。
    """

    def __init__(self):
        self.peers: dict[str, PeerConnection] = {}       # peer_public_id → PeerConnection
        self.group_routes: dict[int, set[str]] = defaultdict(set)  # local_group_id → {peer_public_id}
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

        # 如果已有连接，先断开
        if public_id in self.peers:
            await self._close_peer_connection(public_id)

        try:
            secret = await get_decrypted_secret(peer_record)
        except Exception as e:
            logger.error(f"🌐 解密对等端 {public_id} 共享密钥失败: {e}")
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
                logger.warning(f"🌐 握手超时/无效: {public_id} — {e}")
                await self._close_peer_connection(public_id)
                return False

            if ack.get("type") != "handshake_ack":
                logger.warning(f"🌐 握手阶段收到非预期消息: {ack.get('type')} from {public_id}")
                await self._close_peer_connection(public_id)
                return False

            # 验证对方对我方挑战的应答
            expected_response = hmac_response(secret, my_challenge)
            if ack.get("response") != expected_response:
                logger.warning(f"🌐 HMAC 验证失败: {public_id}（共享密钥不匹配）")
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
                logger.warning(f"🌐 握手完成超时: {public_id} — {e}")
                await self._close_peer_connection(public_id)
                return False

            if ok.get("type") != "handshake_ok":
                logger.warning(f"🌐 握手未获确认: {public_id}")
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
            logger.warning(f"🌐 连接失败 {public_id}: {e}")
            await self._close_peer_connection(public_id)
            try:
                async with async_session() as db:
                    await update_peer_connection_state(db, peer_record.id, "failed")
            except Exception:
                pass
            return False

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

        payload = {
            "type": "forward_message",
            "group_id": group_id,
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
                elif msg_type == "error":
                    logger.warning(f"🌐 {public_id} 报错: {data.get('code')} — {data.get('message')}")
                else:
                    logger.debug(f"🌐 未知消息类型: {msg_type} from {public_id}")
        except Exception as e:
            logger.warning(f"🌐 {public_id} 接收循环异常: {e}")
        finally:
            await self._close_peer_connection(public_id)

    async def _handle_remote_forward(self, from_public_id: str, data: dict) -> None:
        """处理远程转发来的消息"""
        group_id = data.get("group_id")
        msg = data.get("message", {})
        source_public_id = data.get("source_public_id", from_public_id)

        if not group_id or not msg:
            return

        # 持久化并广播到本地
        try:
            async with async_session() as db:
                message = await handle_remote_message(
                    db, group_id, msg, source_public_id
                )
                await db.commit()

                # 构造消息 dict 用于广播
                from app.services.group_service import message_to_dict
                msg_data = message_to_dict(message, sender_name=msg.get("sender_name", "远程用户"))

                # 广播到本地 WebSocket 客户端
                from app.routers.ws import manager
                await manager.broadcast_to_group(
                    group_id,
                    {"type": "message", "conversation_type": "group", "data": msg_data},
                )

                # 如果是人类发送者，推入 AI 回复队列
                if msg.get("sender_type") == "human":
                    from app.services.ai_response_worker import message_queue
                    try:
                        message_queue.put_nowait({
                            "conversation_type": "group",
                            "group_id": group_id,
                            "message_id": message.id,
                            "content": msg.get("content", ""),
                            "sender_type": "human",
                            "sender_id": 0,  # 远程发送者
                            "chain_depth": 0,
                            "source_public_id": source_public_id,
                        })
                    except asyncio.QueueFull:
                        pass

        except Exception as e:
            logger.error(f"🌐 处理远程消息失败: {e}", exc_info=True)

    async def _close_peer_connection(self, public_id: str) -> None:
        """关闭与指定对等端的连接（不清除缓冲）"""
        conn = self.peers.get(public_id)
        if conn is None:
            return

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
