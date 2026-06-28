"""
toggle_thinking 工具 — AI 开启/关闭深度推理模式
"""
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.tools.base import ToolPlugin, ToolRegistry

logger = logging.getLogger(__name__)


class ToggleThinking(ToolPlugin):
    name = "toggle_thinking"
    description = "开启或关闭深度推理模式。开启后回复更慢但思考更深入，适合复杂项目工作、深度分析、代码编写；关闭后回复更快，适合日常聊天。你可以根据当前任务的复杂度自行决定是否开启。"
    segment = "self_config"
    parameters = {
        "enabled": {"type": "boolean", "description": "true 开启推理模式，false 关闭"},
    }
    required = ["enabled"]
    states = ["active", "dnd"]
    admin_description = "开启或关闭深度推理模式。推理模式让 AI 在回答问题前进行深度思考，消耗更多 token 但回答质量更高。"
    trigger_condition = "AI 或管理员切换推理模式时"

    async def execute(self, db: AsyncSession, agent_id: int, group_id: int | None,
                      arguments: dict, context: dict) -> dict:
        from app.models.agent import Agent as AgentModel

        enabled = arguments["enabled"]

        result = await db.execute(select(AgentModel).where(AgentModel.id == agent_id))
        agent = result.scalar_one_or_none()
        if agent is None:
            return {"error": True, "message": "AI 代理不存在"}

        agent.thinking_enabled = enabled
        await db.commit()

        status_text = "已开启" if enabled else "已关闭"
        return {
            "success": True,
            "thinking_enabled": enabled,
            "message": f"深度推理模式{status_text}",
        }


ToolRegistry.register(ToggleThinking)
