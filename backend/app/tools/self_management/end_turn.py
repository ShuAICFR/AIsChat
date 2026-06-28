"""
end_turn 工具 — AI 主动结束当前回复轮次
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.tools.base import ToolPlugin, ToolRegistry

logger = logging.getLogger(__name__)


class EndTurn(ToolPlugin):
    name = "end_turn"
    description = (
        "结束当前回复轮次，把发言权交还给对方。这是正常的收尾动作，不是终结对话——"
        "就像说完话把话筒递回去。发完消息后和 send_message 放在同一个 tool_calls 里一起调用，省一轮 API。"
        "如果同时想切换状态，可设置 set_state。"
    )
    segment = "self_management"
    parameters = {
        "reason": {"type": "string", "description": "结束本轮的原因（可省略，如\"说完了\"）"},
        "set_state": {
            "type": "string", "enum": ["active", "offline"],
            "description": "结束后的状态。默认不改变当前状态，若用户要求停下可设为 offline。",
        },
    }
    required = []
    states = ["active", "dnd", "offline"]

    async def execute(self, db: AsyncSession, agent_id: int, group_id: int | None,
                      arguments: dict, context: dict) -> dict:
        reason = arguments.get("reason")
        set_state = arguments.get("set_state")

        new_state = None
        if set_state and set_state in ("active", "offline"):
            try:
                from app.services.agent_service import switch_agent_state
                await switch_agent_state(
                    db, agent_id=agent_id, target_state=set_state,
                    duration_hours=None,
                    reason=f"end_turn: {reason}" if reason else "end_turn",
                )
                await db.commit()
                new_state = set_state
            except ValueError as e:
                return {"error": True, "message": f"切换状态失败: {e}"}

        return {
            "success": True,
            "end_turn": True,
            "message": f"已结束本轮回复{f'并切换为{new_state}' if new_state else ''}{f'（{reason}）' if reason else ''}",
            "new_state": new_state,
        }


ToolRegistry.register(EndTurn)
