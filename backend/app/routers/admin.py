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
    expires_in_days: int = Field(..., ge=1, le=365)


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
    """生成兑换码"""
    code_str = "RC-" + secrets.token_hex(8).upper()

    code = RedemptionCode(
        code=code_str,
        quota_amount=req.quota_amount,
        expires_at=datetime.now(timezone.utc) + timedelta(days=req.expires_in_days),
        created_by=admin["user_id"],
    )
    db.add(code)

    await _log_admin_action(
        db, admin["user_id"], "generate_code", "redemption_code", 0,
        {"code": code_str, "quota_amount": req.quota_amount},
    )
    await db.flush()

    return {
        "code": code_str,
        "quota_amount": req.quota_amount,
        "expires_in_days": req.expires_in_days,
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
            "expires_at": str(c.expires_at) if c.expires_at else None,
            "used_by": c.used_by,
            "used_at": str(c.used_at) if c.used_at else None,
        }
        for c in codes
    ]


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
