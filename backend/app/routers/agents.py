"""
AI 代理管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.responses import Response
import json
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
)
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
