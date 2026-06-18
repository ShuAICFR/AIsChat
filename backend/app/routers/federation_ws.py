"""
联邦 WebSocket 端点（v1.2.0 跨实例联邦通信）

接受其他 AIsChat 实例的入站连接。
出站连接由 services/federation_manager.py 管理。
"""
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.database import async_session
from app.services.federation_service import (
    get_peer_by_public_id,
    get_decrypted_secret,
    hmac_response,
    generate_challenge,
    handle_remote_message,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/federation/ws")
async def federation_websocket(ws: WebSocket):
    """接受远程实例的连接，完成挑战-应答握手后进入消息循环"""
    await ws.accept()

    peer_public_id = "unknown"
    peer_conn = None  # WebSocket 包装

    try:
        # ── 阶段 1: 等待 handshake ──
        raw = await ws.receive_text()
        try:
            handshake = json.loads(raw)
        except json.JSONDecodeError:
            await ws.send_json({"type": "error", "code": "BAD_JSON", "message": "无效 JSON"})
            await ws.close()
            return

        if handshake.get("type") != "handshake":
            await ws.send_json({"type": "error", "code": "BAD_HANDSHAKE", "message": "预期 handshake"})
            await ws.close()
            return

        peer_public_id = handshake.get("public_id", "unknown")
        their_challenge = handshake.get("challenge", "")

        # 查找对等端记录并验证
        async with async_session() as db:
            peer = await get_peer_by_public_id(db, peer_public_id)
            if peer is None:
                await ws.send_json({
                    "type": "error",
                    "code": "UNKNOWN_PEER",
                    "message": f"未知对等端: {peer_public_id}",
                })
                await ws.close()
                logger.warning(f"🌐 拒绝未知对等端连接: {peer_public_id}")
                return

            if not peer.is_enabled:
                await ws.send_json({
                    "type": "error",
                    "code": "PEER_DISABLED",
                    "message": "此对等端已被禁用",
                })
                await ws.close()
                return

            secret = await get_decrypted_secret(peer)

        # ── 阶段 2: 发送 handshake_ack（回应对方的挑战，给出我方挑战）──
        my_challenge = generate_challenge()
        await ws.send_json({
            "type": "handshake_ack",
            "public_id": await _get_my_public_id(),
            "instance_id": await _get_my_instance_id(),
            "response": hmac_response(secret, their_challenge),
            "challenge": my_challenge,
        })

        # ── 阶段 3: 等待 handshake_finish ──
        raw = await ws.receive_text()
        try:
            finish = json.loads(raw)
        except json.JSONDecodeError:
            await ws.send_json({"type": "error", "code": "BAD_JSON", "message": "无效 JSON"})
            await ws.close()
            return

        if finish.get("type") != "handshake_finish":
            await ws.send_json({
                "type": "error",
                "code": "BAD_HANDSHAKE",
                "message": "预期 handshake_finish",
            })
            await ws.close()
            return

        # 验证对方对我方挑战的应答
        expected_response = hmac_response(secret, my_challenge)
        if finish.get("response") != expected_response:
            await ws.send_json({
                "type": "error",
                "code": "AUTH_FAILED",
                "message": "共享密钥不匹配",
            })
            await ws.close()
            logger.warning(f"🌐 {peer_public_id} HMAC 验证失败")
            return

        # ── 握手成功 ──
        await ws.send_json({"type": "handshake_ok", "instance_id": await _get_my_instance_id()})
        logger.info(f"🌐 ✅ 接受连接: {peer_public_id}")

        # 更新连接状态
        async with async_session() as db:
            from app.services.federation_service import update_peer_connection_state
            await update_peer_connection_state(db, peer.id, "connected")

        # ── 消息循环 ──
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type", "")

            if msg_type == "ping":
                await ws.send_json({"type": "pong"})
            elif msg_type == "pong":
                pass  # 心跳回复
            elif msg_type == "forward_message":
                await _handle_forwarded_message(peer_public_id, data)
            elif msg_type == "subscribe":
                # 远端告知它共享了哪些群，暂时仅记录日志
                logger.info(f"🌐 {peer_public_id} 订阅群: {data.get('group_id')}")
            else:
                logger.debug(f"🌐 忽略消息类型: {msg_type} from {peer_public_id}")

    except WebSocketDisconnect:
        logger.info(f"🌐 {peer_public_id} 断开连接")
    except Exception as e:
        logger.error(f"🌐 {peer_public_id} 连接异常: {e}", exc_info=True)
    finally:
        # 更新断连状态
        try:
            async with async_session() as db:
                peer = await get_peer_by_public_id(db, peer_public_id)
                if peer:
                    from app.services.federation_service import update_peer_connection_state
                    await update_peer_connection_state(db, peer.id, "disconnected")
        except Exception:
            pass


async def _handle_forwarded_message(from_public_id: str, data: dict) -> None:
    """处理对等端转发来的消息"""
    group_id = data.get("group_id")
    msg = data.get("message", {})
    source_public_id = data.get("source_public_id", from_public_id)

    if not group_id or not msg:
        return

    try:
        async with async_session() as db:
            message = await handle_remote_message(db, group_id, msg, source_public_id)
            await db.commit()

            from app.services.group_service import message_to_dict
            msg_data = message_to_dict(message, sender_name=msg.get("sender_name", "远程用户"))

            from app.routers.ws import manager
            await manager.broadcast_to_group(
                group_id,
                {"type": "message", "conversation_type": "group", "data": msg_data},
            )

            if msg.get("sender_type") == "human":
                from app.services.ai_response_worker import message_queue
                try:
                    message_queue.put_nowait({
                        "conversation_type": "group",
                        "group_id": group_id,
                        "message_id": message.id,
                        "content": msg.get("content", ""),
                        "sender_type": "human",
                        "sender_id": 0,
                        "chain_depth": 0,
                        "source_public_id": source_public_id,
                    })
                except Exception:
                    pass
    except Exception as e:
        logger.error(f"🌐 处理转发消息失败: {e}", exc_info=True)


async def _get_my_public_id() -> str:
    """获取本实例的公网 ID"""
    from app.services.federation_service import get_instance_info
    async with async_session() as db:
        info = await get_instance_info(db)
        return info.get("public_id", "") or ""


async def _get_my_instance_id() -> str:
    """获取本实例的子网 UUID"""
    from app.services.federation_service import get_instance_info
    async with async_session() as db:
        info = await get_instance_info(db)
        return info.get("instance_id", "") or ""
