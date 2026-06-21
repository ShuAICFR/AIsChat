"""
搜索服务（v0.4.0: 从 friend_service 中提取，不再依赖好友系统）
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

logger = logging.getLogger(__name__)


async def search_entities(
    db: AsyncSession,
    query: str,
    current_user_id: int,
    limit: int = 20,
) -> list[dict]:
    """搜索用户和 AI（无需好友关系即可发起 DM）"""
    from app.models.user import User
    from app.models.agent import Agent

    results = []
    like_pattern = f"%{query}%"

    # 搜索用户
    user_result = await db.execute(
        select(User).where(
            User.username.ilike(like_pattern),
            User.is_active == True,
        ).limit(limit)
    )
    for user in user_result.scalars().all():
        if user.id == current_user_id:
            continue
        results.append({
            "id": user.id,
            "type": "human",
            "name": user.username,
            "owner_name": None,
            "state": None,
            "user_id": user.id,  # 人类的 user_id 就是自己的 id
        })

    # 搜索 AI（仅返回 discoverable 的 AI）
    agent_result = await db.execute(
        select(Agent).where(
            Agent.name.ilike(like_pattern),
            Agent.discoverable == True,
        ).limit(limit)
    )
    for agent in agent_result.scalars().all():
        from app.models.user import User as UserModel
        owner_result = await db.execute(
            select(UserModel).where(UserModel.id == agent.owner_id)
        )
        owner = owner_result.scalar_one_or_none()
        results.append({
            "id": agent.id,
            "type": "ai",
            "name": agent.name,
            "owner_name": owner.username if owner else None,
            "state": agent.state,
            "user_id": agent.user_id,  # AI 的 unified user_id（用于 DM）
        })

    return results[:limit]
