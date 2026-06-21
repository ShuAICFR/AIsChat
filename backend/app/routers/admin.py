"""
管理员面板路由
所有端点都需要 admin 权限
"""
import secrets
import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from pydantic import BaseModel, Field
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.models.agent import Agent
from app.models.group import Group
from app.models.redemption import RedemptionCode
from app.models.system_log import SystemLog
from app.models.opencli import OpenCLIUsageLog
from app.services.opencli_service import (
    get_opencli_config,
    update_opencli_config,
    list_agent_whitelist,
    update_agent_whitelist,
    list_command_whitelist,
    add_command_whitelist,
    toggle_command_whitelist,
    delete_command_whitelist,
    get_usage_logs,
)
from app.utils.auth import require_admin, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["管理员"])


# ---------- Pydantic 模型 ----------

class BanUserRequest(BaseModel):
    reason: str | None = None
    duration_days: int | None = None


class GenerateCodeRequest(BaseModel):
    quota_amount: int = Field(..., ge=1, le=100)
    code_type: str = Field(default="ai_quota", pattern="^(ai_quota|api_credit|agent_bundle|file_quota)$")
    expires_in_days: int = Field(..., ge=1, le=365)
    note: str | None = None              # v1.0.0: 管理员备注（保密）
    max_usage: int | None = None         # v1.0.0: 单码最大用量
    is_api_pool: bool = False            # v1.0.0: 是否是 API 池额度


class UpdateUserRoleRequest(BaseModel):
    role: str = Field(..., pattern="^(admin|user)$")


class UpdateAgentEditableRequest(BaseModel):
    is_ai_editable: bool


async def _log_admin_action(
    db: AsyncSession,
    operator_id: int,
    log_type: str,
    target_type: str,
    target_id: int,
    details: dict | None = None,
):
    """记录管理员操作"""
    log_entry = SystemLog(
        log_type=log_type,
        operator_type="human",
        operator_id=operator_id,
        target_type=target_type,
        target_id=target_id,
        details=details or {},
    )
    db.add(log_entry)


# ---------- 系统概览 ----------

@router.get("/overview")
async def system_overview(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """系统概览统计"""
    user_count = (await db.execute(select(func.count(User.id)))).scalar()
    agent_count = (await db.execute(select(func.count(Agent.id)))).scalar()
    group_count = (await db.execute(select(func.count(Group.id)))).scalar()

    return {
        "total_users": user_count,
        "total_agents": agent_count,
        "total_groups": group_count,
        "pending_vector_requests": 0,  # TODO: 实现
    }


# ---------- 用户管理 ----------

@router.get("/users")
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """用户列表（分页）"""
    offset = (page - 1) * page_size
    total = (await db.execute(select(func.count(User.id)))).scalar()
    result = await db.execute(
        select(User).order_by(User.created_at.desc()).offset(offset).limit(page_size)
    )
    users = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": u.id,
                "username": u.username,
                "role": u.role,
                "is_active": u.is_active,
                "ai_quota": u.ai_quota,
                "api_credit": u.api_credit,
                "agent_bundle_credit": u.agent_bundle_credit,
                "file_quota_mb": u.file_quota_mb,
                "created_at": str(u.created_at) if u.created_at else None,
            }
            for u in users
        ],
    }


@router.post("/users/{user_id}/ban")
async def ban_user(
    user_id: int,
    req: BanUserRequest,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """封禁/解封用户"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    user.is_active = not user.is_active  # 切换状态

    await _log_admin_action(
        db,
        admin["user_id"],
        "ban_user" if not user.is_active else "unban_user",
        "user",
        user_id,
        {"reason": req.reason, "duration_days": req.duration_days},
    )
    await db.flush()

    return {
        "message": f"用户 {'已封禁' if not user.is_active else '已解封'}",
        "user_id": user_id,
        "is_active": user.is_active,
    }


@router.put("/users/{user_id}/quota")
async def update_user_quota(
    user_id: int,
    quota: int = Query(..., ge=0, le=1000),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """调整用户 AI 创建额度"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    old_quota = user.ai_quota
    user.ai_quota = quota

    await _log_admin_action(
        db, admin["user_id"], "update_quota", "user", user_id,
        {"old_quota": old_quota, "new_quota": quota},
    )
    await db.flush()

    return {"message": "额度已更新", "user_id": user_id, "ai_quota": quota}


@router.put("/users/{user_id}/api-credit")
async def update_user_api_credit(
    user_id: int,
    credit: int = Query(..., ge=0, le=100000),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """调整用户 API 调用额度"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    old_credit = user.api_credit
    user.api_credit = credit

    await _log_admin_action(
        db, admin["user_id"], "update_api_credit", "user", user_id,
        {"old_credit": old_credit, "new_credit": credit},
    )
    await db.flush()

    return {"message": "API 额度已更新", "user_id": user_id, "api_credit": credit}


@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: int,
    req: UpdateUserRoleRequest,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """提升/降级用户角色（admin ↔ user）"""
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能修改自己的角色")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")

    old_role = user.role
    user.role = req.role

    await _log_admin_action(
        db, admin["user_id"], "change_role", "user", user_id,
        {"old_role": old_role, "new_role": req.role},
    )
    await db.flush()

    return {"message": f"用户角色已从 {old_role} 更新为 {req.role}", "user_id": user_id, "role": req.role}


# ---------- AI 管理 ----------

@router.get("/agents")
async def list_all_agents(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """所有 AI 列表"""
    offset = (page - 1) * page_size
    total = (await db.execute(select(func.count(Agent.id)))).scalar()
    result = await db.execute(
        select(Agent).order_by(Agent.created_at.desc()).offset(offset).limit(page_size)
    )
    agents = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": a.id,
                "name": a.name,
                "owner_id": a.owner_id,
                "state": a.state,
                "is_ai_editable": a.is_ai_editable,
                "created_at": str(a.created_at) if a.created_at else None,
            }
            for a in agents
        ],
    }


@router.put("/agents/{agent_id}/editable")
async def toggle_ai_editable(
    agent_id: int,
    req: UpdateAgentEditableRequest,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """开关 AI 自修改能力"""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI 不存在")

    agent.is_ai_editable = req.is_ai_editable

    await _log_admin_action(
        db, admin["user_id"], "toggle_ai_editable", "agent", agent_id,
        {"is_ai_editable": req.is_ai_editable},
    )
    await db.flush()

    return {
        "message": f"AI 自修改已{'开启' if req.is_ai_editable else '关闭'}",
        "agent_id": agent_id,
    }


# ---------- 群聊审查 ----------

@router.get("/groups")
async def list_all_groups(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """所有群聊列表"""
    offset = (page - 1) * page_size
    total = (await db.execute(select(func.count(Group.id)))).scalar()
    result = await db.execute(
        select(Group).order_by(Group.created_at.desc()).offset(offset).limit(page_size)
    )
    groups = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": g.id,
                "name": g.name,
                "owner_type": g.owner_type,
                "owner_id": g.owner_id,
                "is_vector_accelerated": g.is_vector_accelerated,
                "created_at": str(g.created_at) if g.created_at else None,
            }
            for g in groups
        ],
    }


@router.delete("/groups/{group_id}")
async def disband_group(
    group_id: int,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """强制解散群聊"""
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="群聊不存在")

    await db.delete(group)
    await _log_admin_action(db, admin["user_id"], "disband_group", "group", group_id)
    await db.flush()

    return {"message": "群聊已解散", "group_id": group_id}


# ---------- 兑换码 ----------

@router.post("/redemption-codes")
async def generate_code(
    req: GenerateCodeRequest,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """生成兑换码（v1.0.0: 支持备注/最大用量/API 池标记）"""
    code_str = "RC-" + secrets.token_hex(8).upper()

    code = RedemptionCode(
        code=code_str,
        quota_amount=req.quota_amount,
        code_type=req.code_type,
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=req.expires_in_days),
        created_by=admin["user_id"],
        note=req.note,
        max_usage=req.max_usage,
        is_api_pool=req.is_api_pool,
    )
    db.add(code)

    await _log_admin_action(
        db, admin["user_id"], "generate_code", "redemption_code", 0,
        {"code": code_str, "quota_amount": req.quota_amount, "code_type": req.code_type,
         "note": req.note, "is_api_pool": req.is_api_pool},
    )
    await db.flush()

    return {
        "code": code_str,
        "quota_amount": req.quota_amount,
        "code_type": req.code_type,
        "expires_in_days": req.expires_in_days,
        "note": req.note,
        "max_usage": req.max_usage,
        "is_api_pool": req.is_api_pool,
    }


@router.get("/redemption-codes")
async def list_codes(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """列出所有兑换码"""
    result = await db.execute(
        select(RedemptionCode).order_by(RedemptionCode.expires_at.desc())
    )
    codes = result.scalars().all()

    return [
        {
            "code": c.code,
            "quota_amount": c.quota_amount,
            "code_type": c.code_type or "ai_quota",
            "expires_at": str(c.expires_at) if c.expires_at else None,
            "used_by": c.used_by,
            "used_at": str(c.used_at) if c.used_at else None,
            "note": c.note,
            "max_usage": c.max_usage,
            "is_api_pool": c.is_api_pool if c.is_api_pool else False,
            "created_at": str(c.created_at) if c.created_at else None,
        }
        for c in codes
    ]


# ---------- API Key 池管理 ----------

class CreatePoolKeyRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    api_base_url: str | None = None
    api_key: str = Field(..., min_length=1)
    priority: int = Field(default=0, ge=0)


class UpdatePoolKeyRequest(BaseModel):
    name: str | None = None
    api_base_url: str | None = None
    is_active: bool | None = None
    priority: int | None = None


@router.get("/api-key-pool")
async def list_pool_keys(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """列出所有 API Key 池条目（Key 脱敏）"""
    from app.models.api_key_pool import ApiKeyPool

    result = await db.execute(select(ApiKeyPool).order_by(ApiKeyPool.priority.desc()))
    keys = result.scalars().all()

    return [
        {
            "id": k.id,
            "name": k.name,
            "api_base_url": k.api_base_url or settings.deepseek_base_url,
            "api_key_preview": _mask_api_key(k.api_key_encrypted),
            "is_active": k.is_active,
            "priority": k.priority,
            "created_at": str(k.created_at) if k.created_at else None,
            "updated_at": str(k.updated_at) if k.updated_at else None,
        }
        for k in keys
    ]


@router.post("/api-key-pool")
async def create_pool_key(
    req: CreatePoolKeyRequest,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """添加 API Key 到池中（Key 加密存储）"""
    from app.models.api_key_pool import ApiKeyPool
    from app.utils.crypto import encrypt_api_key

    encrypted = encrypt_api_key(req.api_key)

    key_entry = ApiKeyPool(
        name=req.name,
        api_base_url=req.api_base_url,
        api_key_encrypted=encrypted,
        priority=req.priority,
    )
    db.add(key_entry)

    await _log_admin_action(
        db, admin["user_id"], "create_pool_key", "api_key_pool", 0,
        {"name": req.name, "priority": req.priority},
    )
    await db.flush()

    return {
        "id": key_entry.id,
        "name": key_entry.name,
        "api_base_url": key_entry.api_base_url or settings.deepseek_base_url,
        "api_key_preview": _mask_api_key(encrypted),
        "is_active": key_entry.is_active,
        "priority": key_entry.priority,
    }


@router.put("/api-key-pool/{key_id}")
async def update_pool_key(
    key_id: int,
    req: UpdatePoolKeyRequest,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新池 Key 配置（不能查看明文 Key）"""
    from app.models.api_key_pool import ApiKeyPool

    result = await db.execute(select(ApiKeyPool).where(ApiKeyPool.id == key_id))
    key_entry = result.scalar_one_or_none()
    if key_entry is None:
        raise HTTPException(status_code=404, detail="池 Key 不存在")

    if req.name is not None:
        key_entry.name = req.name
    if req.api_base_url is not None:
        key_entry.api_base_url = req.api_base_url
    if req.is_active is not None:
        key_entry.is_active = req.is_active
        from app.services.quota_service import find_best_pool_key
    if req.priority is not None:
        key_entry.priority = req.priority

    await _log_admin_action(
        db, admin["user_id"], "update_pool_key", "api_key_pool", key_id,
        {"changes": req.model_dump(exclude_none=True)},
    )
    await db.flush()

    return {"message": "更新成功", "id": key_id}


@router.delete("/api-key-pool/{key_id}")
async def delete_pool_key(
    key_id: int,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """删除池 Key（同时清除已有用户绑定）"""
    from app.models.api_key_pool import ApiKeyPool, UserApiAssignment

    result = await db.execute(select(ApiKeyPool).where(ApiKeyPool.id == key_id))
    key_entry = result.scalar_one_or_none()
    if key_entry is None:
        raise HTTPException(status_code=404, detail="池 Key 不存在")

    # 清除绑定此 Key 的用户
    bindings = await db.execute(
        select(UserApiAssignment).where(UserApiAssignment.pool_key_id == key_id)
    )
    for b in bindings.scalars().all():
        await db.delete(b)

    await db.delete(key_entry)

    await _log_admin_action(
        db, admin["user_id"], "delete_pool_key", "api_key_pool", key_id,
        {"name": key_entry.name},
    )
    await db.flush()

    return {"message": f"池 Key「{key_entry.name}」已删除"}


def _mask_api_key(encrypted: str) -> str:
    """脱敏显示：如 encrypted 为空返回空，否则显示 ****...后4位（实际是密文后4位）"""
    if not encrypted:
        return ""
    if len(encrypted) <= 4:
        return "****"
    return "****" + encrypted[-4:]


# ---------- 系统日志 ----------

@router.get("/logs")
async def system_logs(
    log_type: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """查看系统日志"""
    offset = (page - 1) * page_size
    query = select(SystemLog)
    if log_type:
        query = query.where(SystemLog.log_type == log_type)
    query = query.order_by(SystemLog.created_at.desc()).offset(offset).limit(page_size)

    total_query = select(func.count(SystemLog.id))
    if log_type:
        total_query = total_query.where(SystemLog.log_type == log_type)

    total = (await db.execute(total_query)).scalar()
    result = await db.execute(query)
    logs = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": log.id,
                "log_type": log.log_type,
                "operator_type": log.operator_type,
                "operator_id": log.operator_id,
                "target_type": log.target_type,
                "target_id": log.target_id,
                "details": log.details,
                "created_at": str(log.created_at) if log.created_at else None,
            }
            for log in logs
        ],
    }



# ============================================================
# 数据库备份/恢复
# ============================================================

@router.get("/backup/download")
async def download_backup(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """下载数据库完整备份（.sql 文件）"""
    from app.services.backup_service import create_backup

    try:
        sql_bytes = await create_backup()
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    await _log_admin_action(
        db, admin["user_id"],
        "db_backup", "system", 0,
        {"size_bytes": len(sql_bytes)},
    )

    return Response(
        content=sql_bytes,
        media_type="application/sql",
        headers={
            "Content-Disposition": f'attachment; filename="aischat_backup_{timestamp}.sql"',
        },
    )


@router.post("/backup/restore")
async def upload_restore(
    file: UploadFile = File(...),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """上传 .sql 备份文件并恢复数据库（⚠️ 覆盖当前所有数据）"""
    from app.services.backup_service import restore_backup

    if not file.filename or not file.filename.endswith(".sql"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅支持 .sql 文件",
        )

    try:
        content = await file.read()
        result = await restore_backup(content)
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    await _log_admin_action(
        db, admin["user_id"], "db_restore", "system", 0,
        {"filename": file.filename, "size_bytes": len(content)},
    )

    return result


@router.get("/backup/full/download")
async def download_full_backup(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """下载完整备份（.tar.gz = 数据库 .sql + 文件目录 /app/data/）"""
    from app.services.backup_service import create_full_backup

    try:
        tar_bytes, sql_size, file_count = await create_full_backup()
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    await _log_admin_action(
        db, admin["user_id"],
        "full_backup", "system", 0,
        {"sql_size": sql_size, "file_count": file_count, "total_bytes": len(tar_bytes)},
    )

    return Response(
        content=tar_bytes,
        media_type="application/gzip",
        headers={
            "Content-Disposition": f'attachment; filename="aischat_full_{timestamp}.tar.gz"',
        },
    )


@router.post("/backup/full/restore")
async def upload_full_restore(
    file: UploadFile = File(...),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """上传 .tar.gz 完整备份并恢复（⚠️ 覆盖数据库 + 所有文件）"""
    from app.services.backup_service import restore_full_backup

    if not file.filename or not (file.filename.endswith(".tar.gz") or file.filename.endswith(".tgz")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅支持 .tar.gz / .tgz 完整备份文件",
        )

    try:
        content = await file.read()
        result = await restore_full_backup(content)
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    await _log_admin_action(
        db, admin["user_id"], "full_restore", "system", 0,
        {"filename": file.filename, "size_bytes": len(content)},
    )

    return result


# ============================================================
# 系统设置（全局默认语言等）
# ============================================================

from app.services.system_settings_service import get_settings, update_settings
from app.schemas.system_settings import UpdateSystemSettingsRequest, SystemSettingsResponse


@router.get("/system-settings", response_model=SystemSettingsResponse)
async def get_system_settings(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取全局系统设置"""
    return await get_settings(db)


@router.put("/system-settings", response_model=SystemSettingsResponse)
async def update_system_settings(
    req: UpdateSystemSettingsRequest,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新全局系统设置"""
    try:
        result = await update_settings(
            db,
            default_language=req.default_language,
            updated_by=admin["user_id"],
        )
        await _log_admin_action(
            db, admin["user_id"], "update_system_settings", "system", 1,
            req.model_dump(exclude_none=True),
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ============================================================
# OpenCLI 权限管理
# ============================================================

# Pydantic 模型（admin 内联）
class OpenCLIConfigBody(BaseModel):
    global_enabled: bool | None = None
    default_rate_limit_per_minute: int | None = Field(default=None, ge=1, le=60)
    timeout_seconds: int | None = Field(default=None, ge=5, le=300)


class AgentWhitelistBody(BaseModel):
    enabled: bool
    rate_limit_override: int | None = None


class CommandWhitelistBody(BaseModel):
    pattern: str = Field(..., min_length=1, max_length=200)
    is_regex: bool = False
    description: str | None = Field(default=None, max_length=200)


@router.get("/opencli/config")
async def get_opencli_config_route(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取 OpenCLI 全局配置"""
    return await get_opencli_config(db)


@router.put("/opencli/config")
async def update_opencli_config_route(
    req: OpenCLIConfigBody,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新 OpenCLI 全局配置"""
    try:
        result = await update_opencli_config(
            db,
            updated_by=admin["user_id"],
            global_enabled=req.global_enabled,
            default_rate_limit_per_minute=req.default_rate_limit_per_minute,
            timeout_seconds=req.timeout_seconds,
        )
        await _log_admin_action(
            db, admin["user_id"], "update_opencli_config", "opencli", 1,
            req.model_dump(exclude_none=True),
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/opencli/agents")
async def list_opencli_agents(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取所有 AI 的 OpenCLI 权限状态"""
    return await list_agent_whitelist(db)


@router.put("/opencli/agents/{agent_id}")
async def update_opencli_agent(
    agent_id: int,
    req: AgentWhitelistBody,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """开关某 AI 的 OpenCLI 权限"""
    try:
        result = await update_agent_whitelist(
            db, agent_id=agent_id,
            enabled=req.enabled,
            rate_limit_override=req.rate_limit_override,
        )
        await _log_admin_action(
            db, admin["user_id"], "update_opencli_agent", "agent", agent_id,
            req.model_dump(),
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/opencli/commands")
async def list_opencli_commands(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取命令白名单列表"""
    return await list_command_whitelist(db)


@router.post("/opencli/commands")
async def add_opencli_command(
    req: CommandWhitelistBody,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """添加命令白名单"""
    try:
        result = await add_command_whitelist(
            db,
            pattern=req.pattern,
            is_regex=req.is_regex,
            description=req.description,
            created_by=admin["user_id"],
        )
        await _log_admin_action(
            db, admin["user_id"], "add_opencli_command", "opencli_command", 0,
            req.model_dump(),
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.put("/opencli/commands/{cmd_id}/toggle")
async def toggle_opencli_command(
    cmd_id: int,
    enabled: bool = Query(True),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """开关某条命令白名单"""
    try:
        return await toggle_command_whitelist(db, cmd_id, enabled)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/opencli/commands/{cmd_id}")
async def delete_opencli_command(
    cmd_id: int,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """删除命令白名单条目"""
    try:
        await delete_command_whitelist(db, cmd_id)
        await _log_admin_action(
            db, admin["user_id"], "delete_opencli_command", "opencli_command", cmd_id,
        )
        return {"message": "已删除", "id": cmd_id}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/opencli/commands/presets")
async def add_opencli_preset_commands(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    一键添加预设命令白名单。
    已存在的命令会自动跳过（不重复添加），返回新增和跳过的列表。
    """
    # ⚠️ 预设命令列表：涵盖文件操作（进程内 Python 实现）、浏览器操作（opencli browser）、
    #    外部 CLI 桥接（gh/docker/obsidian 等）。管理员可根据实际需要自行增删。
    #    - is_regex=False 表示精确匹配命令名
    #    - is_regex=True  表示正则匹配（如 "gh .*" 允许所有 GitHub CLI 子命令）
    presets = [
        # ── 文件操作（AI 在自己的沙箱目录里读写，进程内 Python 实现） ──
        {"pattern": "file_read",   "is_regex": False, "description": "📖 读取文件 — 在自己文件空间里读取文本文件内容"},
        {"pattern": "file_write",  "is_regex": False, "description": "✏️ 写入文件 — 创建或覆盖自己文件空间里的文件（自动建子目录）"},
        {"pattern": "file_list",   "is_regex": False, "description": "📂 列出文件 — 浏览自己文件空间里的文件和子目录"},
        {"pattern": "file_delete", "is_regex": False, "description": "🗑️ 删除文件 — 删除自己文件空间里不需要的文件"},
        {"pattern": "file_info",   "is_regex": False, "description": "ℹ️ 文件信息 — 查看文件大小、修改时间等元信息"},
        {"pattern": "create_dir",  "is_regex": False, "description": "📁 创建目录 — 在自己文件空间里创建新文件夹"},
        # ── 浏览器自动化（操控已登录的 Chrome 浏览器） ──
        {"pattern": "browser",   "is_regex": False, "description": "🌐 浏览器操作 — AI 能打开网页、截图、点击、填表、抓取内容"},
        {"pattern": "list",      "is_regex": False, "description": "📋 列出命令 — AI 查看当前可用的所有 OpenCLI 命令"},
        # ── 外部 CLI 桥接（将已有命令行工具接入 OpenCLI） ──
        {"pattern": "gh .*",     "is_regex": True,  "description": "🐙 GitHub CLI — 浏览仓库、PR、Issue、搜索（需 gh CLI 已登录）"},
        {"pattern": "docker .*", "is_regex": True,  "description": "🐳 Docker — 管理容器、镜像、查看运行状态"},
        {"pattern": "obsidian .*", "is_regex": True, "description": "📝 Obsidian — 读写笔记、搜索知识库"},
        {"pattern": "vercel .*", "is_regex": True,  "description": "▲ Vercel — 部署、查看项目、管理域名"},
        {"pattern": "tg .*",     "is_regex": True,  "description": "📨 Telegram CLI — 收发消息、管理频道"},
        {"pattern": "discord .*", "is_regex": True, "description": "💬 Discord CLI — 发消息、管理服务器"},
        {"pattern": "wx .*",     "is_regex": True,  "description": "💚 微信 CLI — 下载公众号文章、管理消息"},
    ]

    added = []
    skipped = []

    # 先获取已有的白名单，用于去重
    existing = await list_command_whitelist(db)
    existing_patterns = {(e["pattern"], e["is_regex"]) for e in existing}

    for p in presets:
        key = (p["pattern"], p["is_regex"])
        if key in existing_patterns:
            skipped.append(p["pattern"])
            continue
        try:
            entry = await add_command_whitelist(
                db,
                pattern=p["pattern"],
                is_regex=p["is_regex"],
                description=p["description"],
                created_by=admin["user_id"],
            )
            added.append(entry)
        except Exception:
            skipped.append(p["pattern"])

    await _log_admin_action(
        db, admin["user_id"], "add_opencli_presets", "opencli_command", 0,
        {"added": [a["pattern"] for a in added], "skipped": skipped},
    )

    return {
        "message": f"已添加 {len(added)} 个预设命令，跳过 {len(skipped)} 个（已存在）",
        "added": added,
        "skipped": skipped,
    }


@router.get("/opencli/logs")
async def get_opencli_logs(
    agent_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取 OpenCLI 使用日志"""
    return await get_usage_logs(db, agent_id=agent_id, page=page, page_size=page_size)


# ════════════════════════════════════════════════════════════
# 联邦通信管理（v0.3.0）
# ════════════════════════════════════════════════════════════

from app.schemas.federation import (
    InstanceConfigUpdate,
    PeerCreate,
    PeerUpdate,
    GroupShareCreate,
)
from app.services import federation_service as fed_svc


# ── 实例身份 ──

@router.get("/federation/instance")
async def get_federation_instance(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取本实例身份信息"""
    info = await fed_svc.get_instance_info(db)
    return info


@router.put("/federation/instance")
async def update_federation_instance(
    body: InstanceConfigUpdate,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新本实例身份信息"""
    result = await fed_svc.update_instance_info(
        db,
        display_name=body.display_name,
        public_url=body.public_url,
        public_id=body.public_id,
    )
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/federation/instance/regenerate-id")
async def regenerate_federation_id(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """重新生成公网 ID（用于冲突后的补救）"""
    result = await fed_svc.regenerate_public_id(db)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/federation/instance/register")
async def register_federation_public_id(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """将公网 ID 注册到 GitHub 注册表（带冲突检测）"""
    result = await fed_svc.register_public_id(db)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.put("/federation/instance/github-token")
async def set_federation_github_token(
    body: dict,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """在界面中配置 GitHub Token（加密存储，无需 SSH 改 .env）"""
    token = body.get("token", "")
    if not token or not token.strip():
        raise HTTPException(status_code=400, detail="Token 不能为空")
    result = await fed_svc.set_github_token(db, token.strip())
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["message"])
    return {"success": True, "message": "GitHub Token 已加密保存"}


@router.get("/federation/registry")
async def get_federation_registry(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """拉取 GitHub 公开注册表"""
    result = await fed_svc.fetch_github_registry(db)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result["message"])
    return result


# ── 对等端管理 ──

@router.get("/federation/peers")
async def list_federation_peers(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """列出所有对等端"""
    return await fed_svc.list_peers(db)


@router.post("/federation/peers")
async def add_federation_peer(
    body: PeerCreate,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """添加对等端"""
    result = await fed_svc.add_peer(
        db,
        peer_public_id=body.peer_public_id,
        remote_url=body.remote_url,
        shared_secret=body.shared_secret,
        display_name=body.display_name,
    )
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.put("/federation/peers/{peer_id}")
async def update_federation_peer(
    peer_id: int,
    body: PeerUpdate,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新对等端"""
    result = await fed_svc.update_peer(
        db, peer_id,
        display_name=body.display_name,
        remote_url=body.remote_url,
        shared_secret=body.shared_secret,
        is_enabled=body.is_enabled,
    )
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.delete("/federation/peers/{peer_id}")
async def delete_federation_peer(
    peer_id: int,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """移除对等端"""
    result = await fed_svc.remove_peer(db, peer_id)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/federation/peers/{peer_id}/connect")
async def connect_federation_peer(
    peer_id: int,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """手动触发对等端连接"""
    from app.models.federation import FederationPeer
    result = await db.execute(select(FederationPeer).where(FederationPeer.id == peer_id))
    peer = result.scalar_one_or_none()
    if peer is None:
        raise HTTPException(status_code=404, detail="对等端不存在")

    from app.services.federation_manager import federation_manager
    success = await federation_manager.connect_to_peer(peer)
    if not success:
        raise HTTPException(status_code=500, detail="连接失败")
    return {"message": f"已连接到 {peer.peer_public_id}"}


@router.post("/federation/peers/{peer_id}/disconnect")
async def disconnect_federation_peer(
    peer_id: int,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """手动断开对等端"""
    from app.models.federation import FederationPeer
    result = await db.execute(select(FederationPeer).where(FederationPeer.id == peer_id))
    peer = result.scalar_one_or_none()
    if peer is None:
        raise HTTPException(status_code=404, detail="对等端不存在")

    from app.services.federation_manager import federation_manager
    await federation_manager.disconnect_peer(peer.peer_public_id)
    return {"message": f"已断开 {peer.peer_public_id}"}


class URLRotateRequest(BaseModel):
    new_url: str = Field(..., min_length=1, max_length=500)


@router.post("/federation/peers/{peer_id}/rotate-url")
async def rotate_federation_peer_url(
    peer_id: int,
    body: URLRotateRequest,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """手动触发对等端 URL 轮换"""
    from app.models.federation import FederationPeer
    result = await db.execute(select(FederationPeer).where(FederationPeer.id == peer_id))
    peer = result.scalar_one_or_none()
    if peer is None:
        raise HTTPException(status_code=404, detail="对等端不存在")

    if not peer.is_enabled:
        raise HTTPException(status_code=400, detail="对等端已禁用")

    from app.services.federation_manager import federation_manager
    err = await federation_manager.initiate_url_rotation(peer.peer_public_id, body.new_url)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"message": f"已发起 URL 轮换: {peer.peer_public_id} → {body.new_url}"}


# ── 群聊共享 ──

@router.get("/federation/groups/{group_id}/shares")
async def list_group_federation_shares(
    group_id: int,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """查看群聊的联邦共享状态"""
    return await fed_svc.list_group_shares(db, group_id)


@router.post("/federation/groups/{group_id}/shares")
async def add_group_federation_share(
    group_id: int,
    body: GroupShareCreate,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """设置群聊联邦共享"""
    result = await fed_svc.share_group(
        db, group_id, body.peer_id, body.share_direction,
    )
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.delete("/federation/groups/{group_id}/shares/{peer_id}")
async def delete_group_federation_share(
    group_id: int,
    peer_id: int,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """取消群聊联邦共享"""
    result = await fed_svc.unshare_group(db, group_id, peer_id)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["message"])
    return result


# ── 对话日志管理 ──

from pydantic import BaseModel as PydanticBaseModel, Field


class ConvLogConfigBody(PydanticBaseModel):
    max_conversation_logs: int | None = Field(None, ge=1, le=500)
    default_user_conversation_logs: int | None = Field(None, ge=1, le=500)
    default_user_log_access: bool | None = None
    default_delay_reply_enabled: bool | None = None


class ConvLogAgentSettingsBody(PydanticBaseModel):
    conversation_logs_limit: int | None = Field(None, ge=1, le=500)
    user_can_view_logs: bool | None = None


@router.get("/conversation-log/config")
async def get_conv_log_config(
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取对话日志全局配置"""
    from app.services.conversation_log_service import get_config_dict
    return await get_config_dict(db)


@router.put("/conversation-log/config")
async def update_conv_log_config(
    req: ConvLogConfigBody,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新对话日志全局配置"""
    from app.services.conversation_log_service import update_config
    try:
        result = await update_config(
            db,
            updated_by=admin["user_id"],
            max_conversation_logs=req.max_conversation_logs,
            default_user_conversation_logs=req.default_user_conversation_logs,
            default_user_log_access=req.default_user_log_access,
            default_delay_reply_enabled=req.default_delay_reply_enabled,
        )
        await _log_admin_action(
            db, admin["user_id"], "update_conv_log_config", "system", 1,
            req.model_dump(exclude_none=True),
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/conversation-log/agents/{agent_id}/settings")
async def get_agent_conv_log_settings(
    agent_id: int,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取某 AI 的对话日志设置"""
    from app.services.conversation_log_service import get_agent_log_settings
    try:
        return await get_agent_log_settings(db, agent_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.put("/conversation-log/agents/{agent_id}/settings")
async def update_agent_conv_log_settings(
    agent_id: int,
    req: ConvLogAgentSettingsBody,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新某 AI 的对话日志设置"""
    from app.services.conversation_log_service import update_agent_log_settings
    try:
        result = await update_agent_log_settings(
            db, agent_id,
            conversation_logs_limit=req.conversation_logs_limit,
            user_can_view_logs=req.user_can_view_logs,
        )
        await _log_admin_action(
            db, admin["user_id"], "update_agent_conv_log", "agent", agent_id,
            req.model_dump(exclude_none=True),
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/conversation-log/agents/{agent_id}/logs")
async def get_agent_conv_logs(
    agent_id: int,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取某 AI 的对话日志列表（管理员）"""
    from app.services.conversation_log_service import get_agent_logs
    try:
        return await get_agent_logs(db, agent_id, is_admin=True, limit=limit, offset=offset)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/conversation-log/agents/{agent_id}/logs/{log_id}")
async def get_agent_conv_log_detail(
    agent_id: int,
    log_id: int,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取单条对话日志详情（含完整 messages）"""
    from app.services.conversation_log_service import get_log_detail
    try:
        detail = await get_log_detail(db, log_id, is_admin=True)
        if detail is None:
            raise HTTPException(status_code=404, detail="日志不存在")
        return detail
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))


# ============================================================
# Token 用量分析（管理员）
# ============================================================

from datetime import datetime, timedelta, timezone as tz


@router.get("/admin/usage/global")
async def get_global_usage(
    days: int = Query(30, ge=1, le=365),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """全站 token 消耗总览"""
    from app.services.conversation_log_service import get_admin_global_token_stats
    end_date = datetime.now(tz.utc).replace(tzinfo=None)
    start_date = end_date - timedelta(days=days)
    return await get_admin_global_token_stats(db, start_date, end_date)


@router.get("/admin/usage/by-user")
async def get_usage_by_user(
    days: int = Query(30, ge=1, le=365),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """按用户分组的 token 消耗明细"""
    from app.services.conversation_log_service import get_admin_users_token_summary
    end_date = datetime.now(tz.utc).replace(tzinfo=None)
    start_date = end_date - timedelta(days=days)
    return await get_admin_users_token_summary(db, start_date, end_date)


@router.get("/admin/usage/agents/{agent_id}/daily")
async def get_agent_daily_usage_admin(
    agent_id: int,
    days: int = Query(30, ge=1, le=365),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取单个 AI 每日 token 消耗分布"""
    from app.services.conversation_log_service import get_agent_token_daily
    end_date = datetime.now(tz.utc).replace(tzinfo=None)
    start_date = end_date - timedelta(days=days)
    return await get_agent_token_daily(db, agent_id, start_date, end_date)


# ══════════════════════════════════════════════════════════════
# v0.5.0: 系统监控指标
# ══════════════════════════════════════════════════════════════

@router.get("/admin/metrics")
async def get_system_metrics(
    hours: int = Query(24, ge=1, le=168),
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    获取系统性能指标：
    - live: 当前内存中的实时快照
    - timeline: 历史趋势（agent_metrics 表）
    - retention_days: 当前保留天数
    """
    from app.models.agent_metrics import AgentMetricsSnapshot
    from app.services.metrics_collector import metrics
    from datetime import timedelta as _td
    from sqlalchemy import select as _sel_m

    # 实时指标
    live = await metrics.snapshot()

    # 历史趋势
    cutoff = datetime.now(tz.utc).replace(tzinfo=None) - _td(hours=hours)
    result = await db.execute(
        _sel_m(AgentMetricsSnapshot)
        .where(AgentMetricsSnapshot.created_at >= cutoff)
        .order_by(AgentMetricsSnapshot.created_at.asc())
    )
    history = result.scalars().all()

    timeline = []
    for snap in history:
        sd = snap.snapshot_data or {}
        timeline.append({
            "at": snap.created_at.isoformat() if snap.created_at else None,
            "llm_calls": sd.get("llm", {}).get("total_calls", 0),
            "llm_avg_latency": sd.get("llm", {}).get("latency", {}).get("avg", 0),
            "llm_error_rate": sd.get("llm", {}).get("error_rate", 0),
            "messages_per_second": sd.get("messages", {}).get("per_second_last_60s", 0),
            "queue_depth": sd.get("queue", {}).get("max_depth", 0),
            "willingness": sd.get("willingness", {}),
            "errors": sd.get("errors", {}),
        })

    return {
        "live": live,
        "timeline": timeline,
        "hours": hours,
        "retention_days": settings.agent_metrics_retention_days,
    }
