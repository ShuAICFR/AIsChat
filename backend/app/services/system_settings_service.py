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
        "default_platform_credit": row.default_platform_credit or 0,
        "system_prompt_overrides": row.system_prompt_overrides,
        "system_prompt_order": row.system_prompt_order,
        "federation_sync_interval_minutes": row.federation_sync_interval_minutes,
        "updated_by": row.updated_by,
        "updated_at": str(row.updated_at) if row.updated_at else None,
    }


async def update_settings(
    db: AsyncSession,
    default_language: str | None = None,
    default_platform_credit: int | None = None,
    updated_by: int | None = None,
) -> dict:
    """
    更新系统设置（仅更新传入的非空字段）。

    若设置 default_platform_credit > 0，需验证池中至少有一个 active Key。
    修改 default_platform_credit 会批量更新所有用户的 platform_gifted_credit。
    """
    row = await _get_or_create(db)

    if default_language is not None:
        if default_language not in ("zh", "en"):
            raise ValueError("不支持的语言，仅支持 zh / en")
        row.default_language = default_language

    if default_platform_credit is not None:
        # 验证：若 > 0，池中必须有 active Key
        if default_platform_credit > 0:
            from app.models.api_key_pool import ApiKeyPool
            key_result = await db.execute(
                select(ApiKeyPool).where(ApiKeyPool.is_active == True).limit(1)
            )
            if key_result.scalar_one_or_none() is None:
                raise ValueError("API Key 池中没有可用的 Key，无法启用平台赠送额度")

        # 计算 delta → 批量更新所有用户
        old_value = row.default_platform_credit or 0
        delta = default_platform_credit - old_value
        row.default_platform_credit = default_platform_credit

        if delta != 0:
            from app.models.user import User as UserModel
            from sqlalchemy import text
            await db.execute(
                text(
                    "UPDATE users SET platform_gifted_credit = platform_gifted_credit + :delta"
                ),
                {"delta": delta},
            )
            logger.info(
                f"  平台赠送额度变更: {old_value} → {default_platform_credit} "
                f"(delta={delta:+d})，已批量更新所有用户"
            )

    if updated_by is not None:
        row.updated_by = updated_by

    await db.flush()
    await db.refresh(row)
    logger.info(f"系统设置已更新: default_language={row.default_language}, "
                f"default_platform_credit={row.default_platform_credit}")
    return await get_settings(db)
