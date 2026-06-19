"""
AI 代理管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.responses import Response
import json
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.schemas.agent import (
    AgentCreateRequest,
    AgentGenerateRequest,
    AgentGenerateResponse,
    AgentUpdateConfigRequest,
    AgentStateRequest,
    AgentResponse,
    AgentConfigHistoryResponse,
    ApplyPresetRequest,
    WorkspaceFileUpdate,
    WorkspaceResponse,
)
from app.schemas.opencli import OpenCLIExecuteRequest, OpenCLIExecuteResponse
from app.services.opencli_service import execute_opencli
from app.services.group_service import (
    check_unread,
    pause_notifications,
    resume_and_fetch,
    get_pending_messages,
)
from app.services.agent_service import (
    create_agent,
    list_agents,
    get_agent,
    update_agent_config,
    rollback_config,
    switch_agent_state,
    get_config_history,
    generate_agent_personality,
    export_agent_soul,
    import_agent_soul,
    agent_to_dict,
    CONFIG_PROFILES,
    apply_config_profile,
)
from app.services import workspace_service
from app.utils.auth import get_current_user
from app.utils.crypto import decrypt_api_key
from app.models.user import User
from sqlalchemy import select

router = APIRouter(prefix="/agents", tags=["AI 管理"])


@router.get("/models")
async def get_available_models(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回可用模型选项列表（供前端下拉框），附带当前 API 提供商的能力"""
    from app.config import settings

    # 获取当前用户的 API base URL，判断提供商能力
    api_base = await _get_user_api_base(db, current_user["user_id"])
    thinking_supported = settings.is_thinking_supported_for(api_base)
    is_deepseek = "deepseek.com" in api_base

    return {
        "models": settings.get_model_options(),
        "defaults": {
            "chat_model": settings.default_chat_model,
            "work_model": settings.default_work_model,
        },
        "provider": {
            "thinking_supported": thinking_supported,
            "is_deepseek": is_deepseek,
        },
    }


async def _require_agent_owner(
    agent_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """依赖注入：获取 Agent 并校验所有权（管理员可绕过）"""
    agent = await get_agent(db, agent_id)
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI 代理不存在")
    if agent.owner_id != current_user["user_id"] and current_user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问")
    return agent


async def _get_user_api_key(db: AsyncSession, user_id: int) -> str | None:
    """获取用户的 API Key（解密后）"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user and user.api_key_encrypted:
        return decrypt_api_key(user.api_key_encrypted)
    return None


async def _get_user_api_base(db: AsyncSession, user_id: int) -> str:
    """获取用户的 API Base URL"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user and user.api_base_url:
        return user.api_base_url
    from app.config import settings
    return settings.deepseek_base_url


@router.get("", response_model=list[AgentResponse])
async def list_my_agents(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取我的 AI 列表"""
    agents = await list_agents(db, current_user["user_id"])
    return [agent_to_dict(a) for a in agents]


@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
async def create_new_agent(
    req: AgentCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建新 AI（消耗额度）"""
    try:
        agent = await create_agent(
            db,
            owner_id=current_user["user_id"],
            name=req.name,
            system_prompt=req.system_prompt,
            temperature=req.temperature,
            top_p=req.top_p,
            presence_penalty=req.presence_penalty,
            frequency_penalty=req.frequency_penalty,
            chat_model=req.chat_model,
            work_model=req.work_model,
            thinking_enabled=req.thinking_enabled,
            is_admin=current_user["role"] == "admin",
            api_credit_cost=req.api_credit_cost,
            hide_ai_identity=req.hide_ai_identity,
            delay_reply_enabled=req.delay_reply_enabled,
            config_profile=req.config_profile,
            max_tool_rounds=req.max_tool_rounds,
            alarm_max_tool_rounds=req.alarm_max_tool_rounds,
            force_alarm_on_end=req.force_alarm_on_end,
            max_alarms=req.max_alarms,
            is_ai_editable=req.is_ai_editable,
        )
        return agent_to_dict(agent)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/generate", response_model=AgentGenerateResponse)
async def generate_personality(
    req: AgentGenerateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """AI 辅助生成性格配置"""
    try:
        api_key = await _get_user_api_key(db, current_user["user_id"])
        api_base = await _get_user_api_base(db, current_user["user_id"])
        result = await generate_agent_personality(
            description=req.description,
            api_base_url=api_base,
            api_key=api_key,
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"生成失败: {str(e)}",
        )


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent_detail(
    agent_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取 AI 详情"""
    agent = await _require_agent_owner(agent_id, current_user, db)
    return agent_to_dict(agent)


@router.put("/{agent_id}/config", response_model=AgentResponse)
async def update_config(
    agent_id: int,
    req: AgentUpdateConfigRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新 AI 配置（AI 自修改或用户手动修改）"""
    try:
        updates = req.model_dump(exclude_unset=True)
        agent = await update_agent_config(
            db,
            agent_id=agent_id,
            operator_id=current_user["user_id"],
            updates=updates,
            is_admin=current_user["role"] == "admin",
        )
        return agent_to_dict(agent)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/{agent_id}/rollback/{version_id}", response_model=AgentResponse)
async def rollback(
    agent_id: int,
    version_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """回滚 AI 配置到历史版本"""
    try:
        agent = await rollback_config(
            db,
            agent_id=agent_id,
            version_id=version_id if version_id > 0 else -1,
            operator_id=current_user["user_id"],
        )
        return agent_to_dict(agent)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/{agent_id}/state", response_model=AgentResponse)
async def switch_state(
    agent_id: int,
    req: AgentStateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """切换 AI 状态"""
    try:
        agent = await switch_agent_state(
            db,
            agent_id=agent_id,
            target_state=req.target_state,
            duration_hours=req.duration_hours,
            reason=req.reason,
        )
        return agent_to_dict(agent)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/{agent_id}/history", response_model=list[AgentConfigHistoryResponse])
async def config_history(
    agent_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取 AI 配置历史"""
    agent = await _require_agent_owner(agent_id, current_user, db)
    history = await get_config_history(db, agent_id)
    return [
        {
            "id": h.id,
            "agent_id": h.agent_id,
            "system_prompt": h.system_prompt,
            "temperature": h.temperature,
            "top_p": h.top_p,
            "presence_penalty": h.presence_penalty,
            "frequency_penalty": h.frequency_penalty,
            "created_at": str(h.created_at) if h.created_at else None,
        }
        for h in history
    ]


# ---------- 消息聚合 / 暂停通知 ----------

@router.get("/{agent_id}/unread")
async def get_unread_summary(
    agent_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取 AI 的各群聊未读消息摘要"""
    agent = await _require_agent_owner(agent_id, current_user, db)
    summaries = await check_unread(db, agent_id)
    return {"agent_id": agent_id, "groups": summaries}


@router.post("/{agent_id}/pause")
async def pause_agent_notifications(
    agent_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """暂停 AI 的通知（任务期间暂存消息）"""
    agent = await _require_agent_owner(agent_id, current_user, db)
    try:
        await pause_notifications(db, agent_id)
        return {"message": "通知已暂停", "agent_id": agent_id}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/{agent_id}/resume")
async def resume_agent_notifications(
    agent_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """恢复 AI 的通知，返回暂停期间的暂存消息"""
    agent = await _require_agent_owner(agent_id, current_user, db)
    try:
        _, pending = await resume_and_fetch(db, agent_id)
        return {
            "message": "通知已恢复",
            "agent_id": agent_id,
            "pending_count": len(pending),
            "pending_messages": pending,
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ---------- 灵魂存档（导出/导入） ----------

@router.get("/{agent_id}/export")
async def export_soul(
    agent_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """导出 AI 灵魂档案（配置 + 历史 + 记忆 + 好友）"""
    agent = await _require_agent_owner(agent_id, current_user, db)
    try:
        data = await export_agent_soul(db, agent_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    json_str = json.dumps(data, ensure_ascii=False, indent=2)
    safe_name = "".join(c if c.isalnum() or c in "._- " else "_" for c in agent.name)[:30]
    return Response(
        content=json_str.encode("utf-8"),
        media_type="application/json; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="soul_{safe_name}.json"',
        },
    )


@router.post("/import", status_code=status.HTTP_201_CREATED)
async def import_soul(
    file: UploadFile = File(...),
    import_memories: bool = Query(True),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """导入 AI 灵魂档案（JSON 文件）"""
    from app.schemas.agent_export import AgentSoulArchive

    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="仅支持 .json 文件",
        )

    try:
        content = await file.read()
        data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="JSON 格式无效",
        )

    # 校验结构
    errors = AgentSoulArchive.validate(data)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"文件格式不合法: {'; '.join(errors)}",
        )

    try:
        agent = await import_agent_soul(
            db,
            data=data,
            owner_id=current_user["user_id"],
            import_memories=import_memories,
            is_admin=current_user["role"] == "admin",
        )
        return agent_to_dict(agent)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ---------- 删除 AI ----------

@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除 AI（返还 api_credit_cost 额度）"""
    from app.services.agent_service import delete_agent as delete_agent_svc
    try:
        result = await delete_agent_svc(
            db,
            agent_id=agent_id,
            operator_id=current_user["user_id"],
            is_admin=current_user["role"] == "admin",
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ---------- API Token ----------

@router.post("/{agent_id}/token")
async def generate_agent_token(
    agent_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """为 AI 生成/刷新外部 API Token"""
    import secrets
    agent = await _require_agent_owner(agent_id, current_user, db)
    token = "at-" + secrets.token_hex(24)
    agent.api_token = token
    await db.flush()
    return {"agent_id": agent_id, "api_token": token}


@router.get("/{agent_id}/token")
async def get_agent_token(
    agent_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取 AI 当前的 API Token（脱敏）"""
    agent = await _require_agent_owner(agent_id, current_user, db)
    token = agent.api_token
    if token:
        masked = token[:8] + "..." + token[-4:] if len(token) > 12 else token[:4] + "***"
    else:
        masked = None
    return {"agent_id": agent_id, "api_token": masked, "has_token": token is not None}


# ---------- 头像 ----------

@router.post("/{agent_id}/avatar")
async def upload_agent_avatar(
    agent_id: int,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """上传 AI 头像"""
    import os
    import uuid

    agent = await _require_agent_owner(agent_id, current_user, db)

    # 验证文件类型
    allowed_types = {"image/jpeg", "image/png", "image/gif", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 JPEG/PNG/GIF/WebP")

    # 生成唯一文件名
    ext = file.filename.split(".")[-1] if file.filename and "." in file.filename else "png"
    filename = f"avatar_{agent_id}_{uuid.uuid4().hex[:8]}.{ext}"
    upload_dir = "uploads/avatars"
    os.makedirs(upload_dir, exist_ok=True)
    filepath = os.path.join(upload_dir, filename)

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    avatar_url = f"/{upload_dir}/{filename}"
    agent.avatar_url = avatar_url
    await db.flush()

    return {"agent_id": agent_id, "avatar_url": avatar_url}


# ---------- 存储管理 ----------

@router.get("/{agent_id}/storage")
async def get_agent_storage(
    agent_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查看 AI 的文件空间占用"""
    import os
    agent = await _require_agent_owner(agent_id, current_user, db)

    workspace_dir = f"uploads/workspace/{agent_id}"
    total_size = 0
    file_count = 0
    files = []
    if os.path.exists(workspace_dir):
        for dirpath, dirnames, filenames in os.walk(workspace_dir):
            for fn in filenames:
                fp = os.path.join(dirpath, fn)
                size = os.path.getsize(fp)
                total_size += size
                file_count += 1
                files.append({
                    "path": fp.replace("\\", "/"),
                    "size": size,
                    "name": fn,
                })

    return {
        "agent_id": agent_id,
        "workspace_dir": workspace_dir,
        "total_size": total_size,
        "file_count": file_count,
        "files": sorted(files, key=lambda f: f["size"], reverse=True)[:50],
    }


# ---------- 记忆查看 ----------

@router.get("/{agent_id}/memories")
async def get_agent_memories(
    agent_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查看 AI 的所有记忆条目"""
    from app.models.memory import RoughMemory, DetailMemory

    agent = await _require_agent_owner(agent_id, current_user, db)

    # 总数
    total_result = await db.execute(
        select(func.count(RoughMemory.id)).where(
            RoughMemory.owner_type == "ai",
            RoughMemory.owner_id == agent_id,
        )
    )
    total = total_result.scalar() or 0

    # 分页查询
    offset = (page - 1) * page_size
    result = await db.execute(
        select(RoughMemory)
        .where(RoughMemory.owner_type == "ai", RoughMemory.owner_id == agent_id)
        .order_by(RoughMemory.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    memories = result.scalars().all()

    items = []
    for rm in memories:
        detail_result = await db.execute(
            select(DetailMemory).where(DetailMemory.rough_id == rm.id).limit(1)
        )
        detail = detail_result.scalar_one_or_none()
        items.append({
            "id": rm.id,
            "title": rm.title,
            "content": detail.content if detail else None,
            "scope": rm.scope,
            "group_id": rm.group_id,
            "created_at": str(rm.created_at) if rm.created_at else None,
        })

    return {
        "agent_id": agent_id,
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items,
    }


# ---------- OpenCLI 工具调用 ----------

@router.post("/{agent_id}/opencli")
async def execute_opencli_tool(
    agent_id: int,
    req: OpenCLIExecuteRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    AI 工具调用：执行 OpenCLI 命令。
    返回标准工具调用格式（成功返回结果，失败返回 {"error": true, ...}）。
    """
    from app.utils.error_handler import build_tool_error, log_error

    agent = await get_agent(db, agent_id)
    if agent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI 代理不存在")

    try:
        result = await execute_opencli(
            db,
            agent_id=agent_id,
            command=req.command,
            args=req.args,
        )
        return result
    except PermissionError as e:
        await log_error(
            db, "opencli_permission_denied", "ai", agent_id,
            target_type="opencli", details={"command": req.command, "reason": str(e)},
            level="WARNING",
        )
        return build_tool_error("OPENCLI_PERMISSION_DENIED", str(e))
    except TimeoutError as e:
        await log_error(
            db, "opencli_timeout", "ai", agent_id,
            target_type="opencli", details={"command": req.command, "reason": str(e)},
            level="WARNING",
        )
        return build_tool_error("OPENCLI_TIMEOUT", str(e))
    except Exception as e:
        await log_error(
            db, "opencli_exec_failed", "ai", agent_id,
            target_type="opencli", details={"command": req.command, "error": str(e)},
            level="ERROR",
        )
        return build_tool_error("OPENCLI_EXEC_FAILED", f"命令执行失败: {str(e)}")


# ──────────────────────────── 三档 AI 配置 ────────────────────────────

@router.get("/presets")
async def list_config_presets():
    """返回所有可用的配置档位预设"""
    return {
        "presets": [
            {"key": k, "name": v["name"], "description": v["description"],
             "temperature": v["temperature"], "thinking_enabled": v["thinking_enabled"],
             "max_tool_rounds": v.get("max_tool_rounds", 3),
             "alarm_max_tool_rounds": v.get("alarm_max_tool_rounds", 10),
             "force_alarm_on_end": v.get("force_alarm_on_end", False),
             "max_alarms": v.get("max_alarms", 10),
             "delay_reply_enabled": v.get("delay_reply_enabled", False),
             "is_ai_editable": v.get("is_ai_editable", True),
             "hide_ai_identity": v.get("hide_ai_identity", False),
             }
            for k, v in CONFIG_PROFILES.items()
        ],
        "current_default": "custom",
    }


@router.get("/{agent_id}/preset-preview")
async def preview_preset_change(
    agent_id: int,
    profile: str,
    agent: any = Depends(_require_agent_owner),
    db: AsyncSession = Depends(get_db),
):
    """预览切换预设后的变更（不实际应用）"""
    if profile not in CONFIG_PROFILES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"无效的配置档: {profile}，可选: {list(CONFIG_PROFILES.keys())}",
        )
    try:
        preview = await apply_config_profile(db, agent_id, profile, dry_run=True)
        return preview
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/{agent_id}/apply-preset")
async def apply_preset(
    agent_id: int,
    req: ApplyPresetRequest,
    agent: any = Depends(_require_agent_owner),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """应用配置档位到 AI（按升降级规则智能合并，保护用户手动调整）"""
    if req.profile not in CONFIG_PROFILES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"无效的配置档: {req.profile}，可选: {list(CONFIG_PROFILES.keys())}",
        )
    try:
        updated = await apply_config_profile(db, agent_id, req.profile)
        return agent_to_dict(updated)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ──────────────────────────── AI 个人工作区 ────────────────────────────

@router.get("/{agent_id}/workspace", response_model=WorkspaceResponse)
async def get_workspace(
    agent_id: int,
    agent: any = Depends(_require_agent_owner),
    db: AsyncSession = Depends(get_db),
):
    """获取 AI 的工作区文件（TODO / PLAN / JOURNAL）"""
    files = await workspace_service.get_all_workspace_files(db, agent_id)
    return WorkspaceResponse(**files)


@router.put("/{agent_id}/workspace", response_model=WorkspaceResponse)
async def update_workspace(
    agent_id: int,
    req: WorkspaceFileUpdate,
    agent: any = Depends(_require_agent_owner),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新 AI 的工作区文件（也可由 AI 工具调用触发）"""
    if req.file not in ("todo", "plan", "journal"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"无效的文件类型: {req.file}，可选: todo|plan|journal",
        )
    await workspace_service.set_workspace_file(db, agent_id, req.file, req.content)
    files = await workspace_service.get_all_workspace_files(db, agent_id)
    return WorkspaceResponse(**files)
