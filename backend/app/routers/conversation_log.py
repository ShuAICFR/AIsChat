"""
对话日志用户端路由
用户的日志设置 + 查看授权 AI 的对话日志
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.utils.auth import get_current_user

router = APIRouter(tags=["对话日志"])


class UserConvLogLimitBody(BaseModel):
    limit: int = Field(..., ge=1, le=500, description="保留数")


@router.get("/conversation-log/settings")
async def get_my_log_settings(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户的对话日志保留设置"""
    from app.services.conversation_log_service import get_user_log_limit
    return await get_user_log_limit(db, current_user["user_id"])


@router.put("/conversation-log/settings")
async def update_my_log_settings(
    req: UserConvLogLimitBody,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新当前用户的对话日志保留数"""
    from app.services.conversation_log_service import update_user_log_limit
    try:
        return await update_user_log_limit(db, current_user["user_id"], req.limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/conversation-log/agents/{agent_id}/logs")
async def get_agent_logs_user(
    agent_id: int,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查看某 AI 的对话日志（需授权）"""
    from app.services.conversation_log_service import get_agent_logs
    try:
        return await get_agent_logs(
            db, agent_id,
            user_id=current_user["user_id"],
            is_admin=False,
            limit=limit, offset=offset,
        )
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))


@router.get("/conversation-log/agents/{agent_id}/logs/{log_id}")
async def get_agent_log_detail_user(
    agent_id: int,
    log_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查看单条对话日志详情（需授权）"""
    from app.services.conversation_log_service import get_log_detail
    try:
        detail = await get_log_detail(
            db, log_id,
            user_id=current_user["user_id"],
            is_admin=False,
        )
        if detail is None:
            raise HTTPException(status_code=404, detail="日志不存在")
        return detail
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
