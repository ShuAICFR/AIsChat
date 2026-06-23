"""
联邦端点（v1.0.0 ID前缀替代注册表）

- GET /federation/identity — 公开端点，实例身份
- WS /federation/ws   — 实例间 WebSocket 连接
"""
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import async_session, get_db
from app.services.federation_service import (
    get_peer_by_public_id,
    get_decrypted_secret,
    hmac_response,
    generate_challenge,
    handle_remote_message,
    get_instance_info,
    get_federated_entity_by_fid,
    persist_remote_dm_message,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/federation/identity")
async def federation_identity(db: AsyncSession = Depends(get_db)):
    """
    公开端点，返回本实例的 public_id 和 instance_id。
    用于注册表验证（可选）：第三方请求此端点，比对返回的 public_id 是否与注册声明一致。
    无需认证。
    """
    info = await get_instance_info(db)
    return {
        "public_id": info.get("public_id"),
        "instance_id": info.get("instance_id"),
        "display_name": info.get("display_name"),
    }


@router.websocket("/federation/ws")
async def federation_websocket(ws: WebSocket):
    """接受远程实例的连接，完成挑战-应答握手后进入消息循环"""
    await ws.accept()

    peer_public_id = "unknown"

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

        # ── 阶段 2: 发送 handshake_ack ──
        my_challenge = generate_challenge()
        my_public_id, my_instance_id = await _get_my_identity()
        await ws.send_json({
            "type": "handshake_ack",
            "public_id": my_public_id,
            "instance_id": my_instance_id,
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
        await ws.send_json({"type": "handshake_ok", "instance_id": my_instance_id})
        logger.info(f"🌐 ✅ 接受连接: {peer_public_id}")

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
                pass
            elif msg_type == "forward_message":
                await _handle_forwarded_message(peer_public_id, data)
            elif msg_type == "entity_announce":
                from app.services.federation_manager import federation_manager
                await federation_manager._handle_entity_announce(peer_public_id, data)
            elif msg_type == "entity_unannounce":
                from app.services.federation_manager import federation_manager
                await federation_manager._handle_entity_unannounce(peer_public_id, data)
            elif msg_type == "profile_sync":
                from app.services.federation_manager import federation_manager
                await federation_manager._handle_profile_sync(peer_public_id, data)
            elif msg_type in ("url_rotate_propose", "url_rotate_ack", "url_rotate_commit"):
                from app.services.federation_manager import federation_manager
                await federation_manager.handle_inbound_rotation_message(peer_public_id, data, ws)
            elif msg_type == "subscribe":
                logger.info(f"🌐 {peer_public_id} 订阅群: {data.get('group_id')}")
            else:
                logger.debug(f"🌐 忽略消息类型: {msg_type} from {peer_public_id}")

    except WebSocketDisconnect:
        logger.info(f"🌐 {peer_public_id} 断开连接")
    except Exception as e:
        logger.error(f"🌐 {peer_public_id} 连接异常: {e}", exc_info=True)
    finally:
        try:
            async with async_session() as db:
                peer = await get_peer_by_public_id(db, peer_public_id)
                if peer:
                    from app.services.federation_service import update_peer_connection_state
                    await update_peer_connection_state(db, peer.id, "disconnected")
        except Exception:
            pass


async def _handle_forwarded_message(from_public_id: str, data: dict) -> None:
    """处理对等端转发来的消息（v1.0.0: 使用 federated_id 解析）"""
    conversation_type = data.get("conversation_type", "group")
    msg = data.get("message", {})
    source_public_id = data.get("source_public_id", from_public_id)

    if not msg:
        return

    if conversation_type == "group":
        federated_group_id = data.get("federated_group_id", "")
        group_id = None

        if federated_group_id:
            async with async_session() as db:
                entity = await get_federated_entity_by_fid(db, federated_group_id)
                if entity is None:
                    logger.warning(f"🌐 未知联邦群: {federated_group_id} from {from_public_id}")
                    return
                group_id = int(entity.local_ref_id)
        else:
            # 兼容旧格式
            group_id = data.get("group_id")

        if not group_id:
            return

        try:
            async with async_session() as db:
                message = await handle_remote_message(db, int(group_id), msg, source_public_id)
                await db.commit()

                from app.services.group_service import message_to_dict
                msg_data = message_to_dict(message, sender_name=msg.get("sender_name", "远程用户"))

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
                    except Exception:
                        pass
        except Exception as e:
            logger.error(f"🌐 处理转发消息失败: {e}", exc_info=True)

    elif conversation_type == "dm":
        federated_session_id = data.get("federated_session_id", "")
        if federated_session_id:
            async with async_session() as db:
                entity = await get_federated_entity_by_fid(db, federated_session_id)
                if entity is None:
                    logger.warning(f"Unknown federated DM: {federated_session_id}")
                    return
                session_id = entity.local_ref_id
        else:
            session_id = data.get("session_id")

        if not session_id:
            return

        try:
            async with async_session() as db:
                dm_msg = await persist_remote_dm_message(db, str(session_id), msg, source_public_id)
                await db.commit()
                from app.routers.ws import manager
                dm_data = {
                    "id": dm_msg.id if hasattr(dm_msg, 'id') else None,
                    "session_id": str(session_id),
                    "sender_id": 0,
                    "sender_name": msg.get("sender_name", "远程用户"),
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
            logger.error(f"Handle forwarded DM error: {e}")


async def _get_my_identity() -> tuple[str, str]:
    """获取本实例的 public_id 和 instance_id"""
    from app.services.federation_service import get_instance_info
    async with async_session() as db:
        info = await get_instance_info(db)
        return (info.get("public_id", "") or "", info.get("instance_id", "") or "")
