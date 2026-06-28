"""
认证服务
处理用户注册、登录、信息获取
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.user import User
from app.utils.auth import hash_password, verify_password, create_access_token
from app.utils.crypto import encrypt_api_key, decrypt_api_key

logger = logging.getLogger(__name__)


async def register_user(
    db: AsyncSession,
    username: str,
    password: str,
) -> User:
    """
    注册新用户。
    如果是第一个用户，自动设为 admin。
    """
    # 检查用户名是否已存在
    result = await db.execute(select(User).where(User.username == username))
    if result.scalar_one_or_none() is not None:
        raise ValueError("用户名已存在")

    # 判断是否为首个用户
    count_result = await db.execute(select(func.count(User.id)))
    user_count = count_result.scalar()
    is_first = user_count == 0

    user = User(
        username=username,
        password_hash=hash_password(password),
        role="admin" if is_first else "user",
        ai_quota=3,
        setup_completed=False,  # 新用户需完成初始化设置向导
    )
    # 读取全局默认设置（语言 + 平台赠送额度）
    try:
        from app.services.system_settings_service import get_settings
        sys = await get_settings(db)
        user.language = sys.get("default_language", "zh")
        user.platform_gifted_credit = sys.get("default_platform_credit", 0)
        user.file_quota_mb = sys.get("default_file_quota_mb", 100)
    except Exception:
        user.language = "zh"
        user.platform_gifted_credit = 0
        user.file_quota_mb = 100
    db.add(user)
    await db.flush()
    await db.refresh(user)

    if is_first:
        logger.info(f"🎉 首个用户 '{username}' 自动成为管理员")

    return user


async def login_user(
    db: AsyncSession,
    username: str,
    password: str,
) -> dict:
    """
    用户登录，返回 JWT 令牌信息。
    """
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()

    if user is None:
        raise ValueError("用户名或密码错误")

    if not user.is_active:
        raise ValueError("账号已被封禁")

    if not verify_password(password, user.password_hash):
        raise ValueError("用户名或密码错误")

    access_token = create_access_token({
        "user_id": user.id,
        "username": user.username,
        "role": user.role,
    })

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user.id,
        "username": user.username,
        "role": user.role,
        "setup_completed": getattr(user, "setup_completed", True),
        "language": getattr(user, "language", "zh") or "zh",
    }


async def get_user_info(db: AsyncSession, user_id: int) -> dict:
    """获取用户信息"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise ValueError("用户不存在")

    # v0.6.0: 查询绑定的池 Key 名
    assigned_pool_key_name = None
    try:
        from app.models.api_key_pool import UserApiAssignment, ApiKeyPool
        assign_result = await db.execute(
            select(ApiKeyPool.name).join(
                UserApiAssignment, UserApiAssignment.pool_key_id == ApiKeyPool.id
            ).where(UserApiAssignment.user_id == user_id)
        )
        assigned_pool_key_name = assign_result.scalar()
    except Exception:
        pass

    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "is_active": user.is_active,
        "ai_quota": user.ai_quota,
        "api_credit": user.api_credit,
        "platform_gifted_credit": getattr(user, 'platform_gifted_credit', 0) or 0,
        "total_effective": max(0, getattr(user, 'platform_gifted_credit', 0) or 0) + (user.api_credit or 0),
        "agent_bundle_credit": user.agent_bundle_credit,
        "file_quota_mb": user.file_quota_mb,
        "avatar_url": getattr(user, 'avatar_url', None),
        "bio": getattr(user, 'bio', None),
        "api_base_url": user.api_base_url,
        "has_api_key": user.api_key_encrypted is not None,
        "auto_approve_vector_timeout": user.auto_approve_vector_timeout,
        "auto_approve_vector_default": user.auto_approve_vector_default,
        "timezone": user.timezone or "Asia/Shanghai",
        "language": user.language or "zh",
        "ui_prefs": user.ui_prefs or {},
        "setup_completed": getattr(user, "setup_completed", True),
        "created_at": str(user.created_at) if user.created_at else None,
        "assigned_pool_key_name": assigned_pool_key_name,
    }


async def update_user_settings(
    db: AsyncSession,
    user_id: int,
    username: str | None = None,
    password: str | None = None,
    api_base_url: str | None = None,
    api_key: str | None = None,
    auto_approve_vector_timeout: int | None = None,
    auto_approve_vector_default: bool | None = None,
    timezone: str | None = None,
    language: str | None = None,
    ui_prefs: dict | None = None,
    avatar_url: str | None = None,
    bio: str | None = None,
) -> dict:
    """更新用户设置（含用户名和密码修改）"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise ValueError("用户不存在")

    if username is not None:
        # 检查用户名唯一性
        existing = await db.execute(select(User).where(User.username == username, User.id != user_id))
        if existing.scalar_one_or_none():
            raise ValueError("用户名已被占用")
        user.username = username
    if password is not None:
        user.password_hash = hash_password(password)
    if api_base_url is not None:
        user.api_base_url = api_base_url
    if api_key is not None:
        user.api_key_encrypted = encrypt_api_key(api_key)
    if auto_approve_vector_timeout is not None:
        user.auto_approve_vector_timeout = auto_approve_vector_timeout
    if auto_approve_vector_default is not None:
        user.auto_approve_vector_default = auto_approve_vector_default
    if timezone is not None:
        user.timezone = timezone
    if language is not None:
        user.language = language
    if ui_prefs is not None:
        user.ui_prefs = ui_prefs
    if avatar_url is not None:
        user.avatar_url = avatar_url
    if bio is not None:
        user.bio = bio

    await db.flush()
    await db.refresh(user)
    return await get_user_info(db, user_id)
