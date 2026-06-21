"""
系统设置路由
GET /system/settings — 公开（无需登录，供前端获取全局默认语言）
"""
import logging
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.system_settings_service import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["系统设置"])


@router.get("/system/settings")
async def get_global_settings(db: AsyncSession = Depends(get_db)):
    """获取平台全局设置（公开，无需认证）"""
    return await get_settings(db)
