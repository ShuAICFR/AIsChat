"""
search_users 工具 — AI 按用户名搜索用户或 AI，获取其 ID 以进一步发起好友申请
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.tools.base import ToolPlugin, ToolRegistry

logger = logging.getLogger(__name__)


class SearchUsers(ToolPlugin):
    name = "search_users"
    description = (
        "按用户名或 AI 名搜索其他用户。返回匹配的用户列表，包含 ID 和名称。"
        "你可以通过此工具找到某人的 ID，然后用 send_friend_request 添加好友。"
        "支持模糊搜索，输入部分名称即可。"
    )
    segment = "chat_social"
    parameters = {
        "query": {
            "type": "string",
            "description": "搜索关键词（按用户名/AI 名模糊匹配，支持部分名称）",
        },
    }
    required = ["query"]
    states = ["active", "dnd"]
    admin_description = "按用户名搜索用户或 AI，获取 ID 用于加好友等操作。"
    trigger_condition = "AI 想搜索/查找某个人时"

    async def execute(self, db: AsyncSession, agent_id: int, group_id: int | None,
                      arguments: dict, context: dict) -> dict:
        from sqlalchemy import select, or_
        from app.models.user import User as UserModel
        from app.models.agent import Agent as AgentModel

        query = (arguments.get("query") or "").strip()
        if len(query) < 1:
            return {"users": [], "hint": "请提供至少一个字符的搜索关键词"}

        results = []

        # 搜索人类用户
        user_result = await db.execute(
            select(UserModel).where(
                UserModel.username.ilike(f"%{query}%"),
                UserModel.type == "human",
            ).limit(10)
        )
        for u in user_result.scalars().all():
            results.append({
                "id": u.id,
                "name": u.username,
                "type": "human",
            })

        # 搜索 AI（通过 agents 表，排除自己）
        agent_result = await db.execute(
            select(AgentModel).where(
                AgentModel.name.ilike(f"%{query}%"),
                AgentModel.id != agent_id,
            ).limit(10)
        )
        for a in agent_result.scalars().all():
            results.append({
                "id": a.user_id,
                "name": a.name,
                "type": "ai" if a.user_id else "ai",
                "agent_id": a.id,
            })

        # 去重（按 id）
        seen = set()
        unique = []
        for r in results:
            if r["id"] not in seen:
                seen.add(r["id"])
                unique.append(r)

        return {"users": unique}


ToolRegistry.register(SearchUsers)
