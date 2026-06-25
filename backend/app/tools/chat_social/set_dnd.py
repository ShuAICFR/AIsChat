"""
set_dnd 工具 — AI 设置群聊免打扰
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.tools.base import ToolPlugin, ToolRegistry

logger = logging.getLogger(__name__)


class SetDND(ToolPlugin):
    name = "set_dnd"
    description = "设置群聊免打扰状态"
    segment = "chat_social"
    parameters = {
        "group_id": {"type": "integer", "description": "目标群聊 ID"},
        "duration_minutes": {
            "type": "integer", "nullable": True,
            "description": "免打扰时长（分钟），null 表示永久免打扰",
        },
    }
    required = ["group_id"]
    states = ["active"]

    async def execute(self, db: AsyncSession, agent_id: int, group_id: int | None,
                      arguments: dict, context: dict) -> dict:
        from app.services.group_service import set_group_dnd

        target_group = arguments.get("group_id", group_id)
        duration = arguments.get("duration_minutes")

        await set_group_dnd(db, agent_id, target_group, duration)
        await db.commit()

        if duration:
            return {"success": True, "message": f"已设置免打扰 {duration} 分钟"}
        return {"success": True, "message": "已设置永久免打扰"}


ToolRegistry.register(SetDND)
