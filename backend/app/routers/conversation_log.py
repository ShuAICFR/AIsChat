"""
对话日志用户端路由
用户的日志设置 + 查看授权 AI 的对话日志 + 导出
"""
import json
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import PlainTextResponse
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


# ============================================================
# 导出端点
# ============================================================

def _format_log_as_markdown(log: dict) -> str:
    """将对话日志格式化为 Markdown"""
    lines = [
        f"# AI 对话日志 #{log.get('id')}",
        f"",
        f"- **AI ID**: {log.get('agent_id')}",
        f"- **类型**: {log.get('conversation_type')}",
        f"- **模型**: {log.get('model', 'N/A')}",
        f"- **深度推理**: {'开启' if log.get('thinking_enabled') else '关闭'}",
        f"- **消息数**: {log.get('message_count')}",
        f"- **有输出**: {'是' if log.get('has_output') else '否'}",
        f"- **时间**: {log.get('created_at', 'N/A')}",
        f"",
    ]
    token_usage = log.get('token_usage')
    if token_usage:
        lines.append(f"- **Token 用量**: {json.dumps(token_usage, ensure_ascii=False)}")
        lines.append(f"")
    lines.append(f"---")
    lines.append(f"")

    messages = log.get('messages', [])
    for i, msg in enumerate(messages):
        role = msg.get('role', 'unknown')
        content = msg.get('content', '')
        if isinstance(content, list):
            # 多模态消息
            parts = []
            for part in content:
                if isinstance(part, dict):
                    if part.get('type') == 'text':
                        parts.append(part.get('text', ''))
                    elif part.get('type') == 'image_url':
                        parts.append('[图片]')
                    elif part.get('type') == 'tool_use':
                        parts.append(f"[工具调用: {part.get('name', '')}]")
                    elif part.get('type') == 'tool_result':
                        parts.append(f"[工具结果]")
                    else:
                        parts.append(json.dumps(part, ensure_ascii=False))
            content = '\n'.join(parts)

        tool_calls = msg.get('tool_calls')
        reasoning = msg.get('reasoning_content')

        if role == 'system':
            lines.append(f"### 📋 System")
        elif role == 'user':
            lines.append(f"### 👤 User")
        elif role == 'assistant':
            lines.append(f"### 🤖 Assistant")
        elif role == 'tool':
            lines.append(f"### 🔧 Tool")
        else:
            lines.append(f"### {role}")

        lines.append(f"")

        if reasoning:
            lines.append(f"> **推理过程**:")
            lines.append(f"> ")
            for rl in reasoning.split('\n'):
                lines.append(f"> {rl}")
            lines.append(f"")

        if content:
            lines.append(content)
            lines.append(f"")

        if tool_calls:
            lines.append(f"**工具调用**:")
            for tc in (tool_calls if isinstance(tool_calls, list) else [tool_calls]):
                fn = tc.get('function', {}) if isinstance(tc, dict) else {}
                lines.append(f"- `{fn.get('name', tc.get('name', 'unknown'))}`")
                args = fn.get('arguments', tc.get('arguments', ''))
                if args:
                    lines.append(f"  ```json")
                    lines.append(f"  {args if isinstance(args, str) else json.dumps(args, ensure_ascii=False)}")
                    lines.append(f"  ```")
            lines.append(f"")

        lines.append(f"---")
        lines.append(f"")

    return '\n'.join(lines)


@router.get("/conversation-log/agents/{agent_id}/logs/{log_id}/export")
async def export_log_detail(
    agent_id: int,
    log_id: int,
    format: str = Query("json", pattern=r"^(json|md|markdown)$"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """导出单条对话日志（JSON 或 Markdown）"""
    from app.services.conversation_log_service import get_log_detail
    try:
        detail = await get_log_detail(
            db, log_id,
            user_id=current_user["user_id"],
            is_admin=False,
        )
        if detail is None:
            raise HTTPException(status_code=404, detail="日志不存在")
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))

    if format in ('md', 'markdown'):
        md = _format_log_as_markdown(detail)
        return PlainTextResponse(md, media_type="text/markdown; charset=utf-8",
                                 headers={"Content-Disposition": f"attachment; filename=log-{log_id}.md"})
    else:
        return PlainTextResponse(
            json.dumps(detail, ensure_ascii=False, indent=2, default=str),
            media_type="application/json; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename=log-{log_id}.json"},
        )
