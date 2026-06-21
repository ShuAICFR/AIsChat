"""
系统设置服务
单行表模式（id=1），懒初始化
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.system_settings import SystemSettings

logger = logging.getLogger(__name__)


async def _get_or_create(db: AsyncSession) -> SystemSettings:
    """获取系统设置行，不存在则创建（懒初始化）"""
    result = await db.execute(select(SystemSettings).where(SystemSettings.id == 1))
    row = result.scalar_one_or_none()
    if row is None:
        row = SystemSettings(id=1, default_language="en")
        db.add(row)
        await db.flush()
        await db.refresh(row)
        logger.info("已初始化 system_settings（默认语言=en）")
    return row


async def get_settings(db: AsyncSession) -> dict:
    """获取系统设置"""
    row = await _get_or_create(db)
    return {
        "id": row.id,
        "default_language": row.default_language,
        "updated_by": row.updated_by,
        "updated_at": str(row.updated_at) if row.updated_at else None,
    }


async def update_settings(
    db: AsyncSession,
    default_language: str | None = None,
    updated_by: int | None = None,
) -> dict:
    """更新系统设置（仅更新传入的非空字段）"""
    row = await _get_or_create(db)
    if default_language is not None:
        if default_language not in ("zh", "en"):
            raise ValueError("不支持的语言，仅支持 zh / en")
        row.default_language = default_language
    if updated_by is not None:
        row.updated_by = updated_by
    await db.flush()
    await db.refresh(row)
    logger.info(f"系统设置已更新: default_language={row.default_language}")
    return await get_settings(db)
