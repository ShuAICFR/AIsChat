"""
私信（DM）路由
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.utils.auth import get_current_user
from app.services.dm_service import (
    get_or_create_dm_session,
    list_dm_sessions,
    get_dm_session,
    get_dm_messages,
    send_dm_message,
    set_dm_dnd,
    cancel_dm_dnd,
)

router = APIRouter(tags=["私信"])


@router.post("/dm/{target_user_id}")
async def create_or_get_dm(
    target_user_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取或创建与目标用户的私信会话"""
    try:
        return await get_or_create_dm_session(
            db,
            current_user_id=current_user["user_id"],
            target_user_id=target_user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/dm/sessions")
async def list_my_dm_sessions(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户的所有私信会话列表"""
    return await list_dm_sessions(db, user_id=current_user["user_id"])


@router.get("/dm/{session_id}")
async def get_dm_detail(
    session_id: str,
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取私信会话详情（含最近消息）"""
    try:
        return await get_dm_session(
            db, session_id, current_user["user_id"], message_limit=limit,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/dm/{session_id}/messages")
async def get_dm_message_list(
    session_id: str,
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = Query(None),
    after_id: int | None = Query(None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取私信消息列表（游标分页，自动标记已读）"""
    try:
        return await get_dm_messages(
            db, session_id, current_user["user_id"],
            limit=limit, before_id=before_id, after_id=after_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/dm/{session_id}/messages", status_code=status.HTTP_201_CREATED)
async def send_dm(
    session_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """发送私信消息"""
    try:
        msg = await send_dm_message(
            db, session_id,
            sender_id=current_user["user_id"],
            content=body.get("content", ""),
            reply_to=body.get("reply_to"),
            attachments=body.get("attachments"),
        )
        # 触发 AI 回复（如果对方是 AI）
        await _maybe_trigger_dm_ai_reply(db, session_id, msg, current_user["user_id"])
        return msg
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/dm/{session_id}/dnd")
async def set_dm_dnd_endpoint(
    session_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """设置私信免打扰（body: { duration_minutes: int | null }）"""
    try:
        return await set_dm_dnd(
            db, session_id, current_user["user_id"],
            duration_minutes=body.get("duration_minutes"),
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/dm/{session_id}/export")
async def export_dm_chat(
    session_id: str,
    fmt: str = Query("json", pattern="^(json|txt|html)$"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """导出私信记录（json / txt / html）"""
    from app.services.dm_service import get_dm_session as _get_dm
    from app.services.export_service import export_dm_chat_history

    # 校验用户是参与者
    try:
        await _get_dm(db, session_id, current_user["user_id"], message_limit=1)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))

    try:
        content, media_type, filename = await export_dm_chat_history(
            db, session_id, fmt, date_from, date_to
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.post("/dm/{session_id}/dnd/cancel")
async def cancel_dm_dnd_endpoint(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """取消私信免打扰"""
    try:
        return await cancel_dm_dnd(db, session_id, current_user["user_id"])
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ============================================================
# 内部：AI 回复触发
# ============================================================

async def _maybe_trigger_dm_ai_reply(
    db: AsyncSession,
    session_id: str,
    msg: dict,
    sender_id: int,
):
    """如果消息的接收方是 AI，触发 AI 自动回复"""
    from app.models.dm import DMSession
    from app.models.user import User

    # 找到接收方
    result = await db.execute(
        select(DMSession).where(DMSession.session_id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        return

    receiver_id = session.user2_id if session.user1_id == sender_id else session.user1_id

    # 检查接收方是否是 AI
    user_result = await db.execute(
        select(User).where(User.id == receiver_id, User.type == "ai")
    )
    ai_user = user_result.scalar_one_or_none()
    if ai_user is None:
        return

    # 找到对应的 agent
    from app.models.agent import Agent
    agent_result = await db.execute(
        select(Agent).where(Agent.user_id == receiver_id)
    )
    agent = agent_result.scalar_one_or_none()
    if agent is None:
        return

    # 推入 AI 回复队列
    from app.services.ai_response_worker import message_queue
    import asyncio
    try:
        message_queue.put_nowait({
            "conversation_type": "dm",
            "session_id": session_id,
            "message_id": msg["id"],
            "content": msg["content"],
            "sender_type": "human" if sender_id != receiver_id else "ai",
            "sender_id": sender_id,
            "chain_depth": 0,
        })
    except asyncio.QueueFull:
        import logging
        logging.getLogger(__name__).warning("AI 回复队列已满，丢弃 DM 事件")
