"""
end_turn 工具 — AI 结束当前回复轮次（不改变状态）
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.tools.base import ToolPlugin, ToolRegistry

logger = logging.getLogger(__name__)


class EndTurn(ToolPlugin):
    name = "end_turn"
    description = (
        "结束当前回复轮次，把发言权交还给对方。不是结束对话，是说完话递话筒。"
        "发完消息后和 send_message 放同一个 tool_calls 里一起调用。"
    )
    segment = "self_management"
    parameters = {}
    required = []
    states = ["active", "dnd", "offline"]

    async def execute(self, db: AsyncSession, agent_id: int, group_id: int | None,
                      arguments: dict, context: dict) -> dict:
        return {
            "success": True,
            "end_turn": True,
            "message": "已结束本轮回复",
        }


ToolRegistry.register(EndTurn)
