"""
好友系统服务
处理好友申请、接受、拒绝、删除、搜索
"""
import logging
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_

logger = logging.getLogger(__name__)


async def send_friend_request(
    db: AsyncSession,
    requester_id: int,
    target_type: str,
    target_id: int,
    message: str | None = None,
) -> dict:
    """发送好友申请"""
    from app.models.friendship import FriendshipRequest, Friendship

    # 检查是否已是好友
    existing_friend = await db.execute(
        select(Friendship).where(
            Friendship.user_id == requester_id,
            Friendship.friend_type == target_type,
            Friendship.friend_id == target_id,
        )
    )
    if existing_friend.scalar_one_or_none():
        raise ValueError("已经是好友了")

    # 检查是否已有待处理的申请
    existing_req = await db.execute(
        select(FriendshipRequest).where(
            FriendshipRequest.requester_id == requester_id,
            FriendshipRequest.target_type == target_type,
            FriendshipRequest.target_id == target_id,
            FriendshipRequest.status == "pending",
        )
    )
    if existing_req.scalar_one_or_none():
        raise ValueError("已发送过好友申请，请等待对方处理")

    # 检查对方是否已向自己发送申请（双向申请自动接受）
    # 支持 human↔human、AI(user_id)↔human、跨类型双向自动接受
    from app.models.agent import Agent as AgentModel
    reverse = await _find_reverse_request(db, requester_id, target_type, target_id)
    if reverse:
        reverse.status = "accepted"
        reverse.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)
        # 解析 reverse 中的双方身份
        r_user_id = reverse.requester_id
        r_type = reverse.target_type
        r_target = reverse.target_id
        # 双向添加好友
        db.add(Friendship(user_id=requester_id, friend_type=target_type, friend_id=target_id))
        db.add(Friendship(user_id=r_user_id, friend_type=r_type, friend_id=r_target))
        await db.flush()
        # 获取反向申请发起者的名称
        reverse_name = None
        try:
            from app.models.user import User
            name_result = await db.execute(select(User.username).where(User.id == r_user_id))
            reverse_name = name_result.scalar_one_or_none()
        except Exception:
            pass
        return {
            "status": "accepted", "auto": True,
            "message": "对方已向你发送申请，已自动成为好友",
            "reverse_message": reverse.message,
            "reverse_target_name": reverse_name or f"用户{r_user_id}",
        }

    # 创建申请
    req = FriendshipRequest(
        requester_id=requester_id,
        target_type=target_type,
        target_id=target_id,
        message=message,
    )
    db.add(req)
    await db.flush()
    await db.refresh(req)

    logger.info(f"用户 {requester_id} 向 {target_type}:{target_id} 发送好友申请")
    return {"status": "pending", "request_id": req.id}


async def accept_friend_request(
    db: AsyncSession,
    request_id: int,
    user_id: int,
) -> dict:
    """接受好友申请"""
    from app.models.friendship import FriendshipRequest, Friendship

    req = await _get_request(db, request_id)
    if req is None:
        raise ValueError("申请不存在")

    # 权限检查：只有目标用户可以接受
    if req.target_type == "human" and req.target_id != user_id:
        raise ValueError("无权操作此申请")

    if req.status != "pending":
        raise ValueError(f"申请状态为 {req.status}，无法接受")

    req.status = "accepted"
    req.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)

    # 添加双向好友关系
    db.add(Friendship(
        user_id=req.requester_id,
        friend_type=req.target_type,
        friend_id=req.target_id,
    ))
    # 如果目标是人类，也添加反向好友
    if req.target_type == "human":
        db.add(Friendship(
            user_id=req.target_id,
            friend_type="human",
            friend_id=req.requester_id,
        ))

    await db.flush()
    logger.info(f"好友申请 {request_id} 已接受")
    return {"status": "accepted"}


async def reject_friend_request(
    db: AsyncSession,
    request_id: int,
    user_id: int,
) -> dict:
    """拒绝好友申请"""
    from app.models.friendship import FriendshipRequest

    req = await _get_request(db, request_id)
    if req is None:
        raise ValueError("申请不存在")

    if req.target_type == "human" and req.target_id != user_id:
        raise ValueError("无权操作此申请")

    if req.status != "pending":
        raise ValueError(f"申请状态为 {req.status}，无法拒绝")

    req.status = "rejected"
    req.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)

    await db.flush()
    logger.info(f"好友申请 {request_id} 已拒绝")
    return {"status": "rejected"}


async def remove_friend(
    db: AsyncSession,
    user_id: int,
    friend_type: str,
    friend_id: int,
) -> dict:
    """删除好友"""
    from app.models.friendship import Friendship

    # 删除自己的好友关系
    result = await db.execute(
        select(Friendship).where(
            Friendship.user_id == user_id,
            Friendship.friend_type == friend_type,
            Friendship.friend_id == friend_id,
        )
    )
    friendship = result.scalar_one_or_none()
    if friendship is None:
        raise ValueError("好友关系不存在")

    await db.delete(friendship)

    # 如果对方是人类，也删除对方的好友关系
    if friend_type == "human":
        reverse_result = await db.execute(
            select(Friendship).where(
                Friendship.user_id == friend_id,
                Friendship.friend_type == "human",
                Friendship.friend_id == user_id,
            )
        )
        reverse = reverse_result.scalar_one_or_none()
        if reverse:
            await db.delete(reverse)

    await db.flush()
    logger.info(f"用户 {user_id} 删除了好友 {friend_type}:{friend_id}")
    return {"status": "removed"}


async def list_friends(
    db: AsyncSession,
    user_id: int,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """获取好友列表"""
    from app.models.friendship import Friendship
    from app.models.user import User
    from app.models.agent import Agent
    from app.models.dm import DMSession
    from app.services.dm_service import generate_dm_session_id

    result = await db.execute(
        select(Friendship)
        .where(Friendship.user_id == user_id)
        .order_by(Friendship.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    friendships = result.scalars().all()

    friends = []
    for f in friendships:
        name = f"未知:{f.friend_id}"
        state = None
        friend_user_id = None
        if f.friend_type == "human":
            user_result = await db.execute(select(User).where(User.id == f.friend_id))
            user = user_result.scalar_one_or_none()
            if user:
                name = user.username
                friend_user_id = user.id  # human: friend_id 即 users.id
        elif f.friend_type == "ai":
            agent_result = await db.execute(select(Agent).where(Agent.id == f.friend_id))
            agent = agent_result.scalar_one_or_none()
            if agent:
                name = agent.name
                state = agent.state
                friend_user_id = agent.user_id  # ai: 查 agent.user_id

        # 查询最近私信时间
        last_dm_at = None
        if friend_user_id:
            session_id = generate_dm_session_id(user_id, friend_user_id)
            dm_result = await db.execute(
                select(DMSession.last_message_at).where(DMSession.session_id == session_id)
            )
            dm_at = dm_result.scalar_one_or_none()
            if dm_at:
                last_dm_at = str(dm_at)

        friends.append({
            "id": f.id,
            "friend_type": f.friend_type,
            "friend_id": f.friend_id,
            "friend_user_id": friend_user_id,
            "friend_name": name,
            "state": state,
            "created_at": str(f.created_at) if f.created_at else None,
            "last_dm_at": last_dm_at,
        })

    return friends


async def list_friend_requests(
    db: AsyncSession,
    user_id: int,
    status: str = "pending",
) -> list[dict]:
    """获取好友申请列表（收到 + 发出的）"""
    from app.models.friendship import FriendshipRequest
    from app.models.user import User
    from app.models.agent import Agent

    # 收到的申请
    received = await db.execute(
        select(FriendshipRequest).where(
            FriendshipRequest.target_type == "human",
            FriendshipRequest.target_id == user_id,
            FriendshipRequest.status == status,
        ).order_by(FriendshipRequest.created_at.desc())
    )
    # 发出的申请
    sent = await db.execute(
        select(FriendshipRequest).where(
            FriendshipRequest.requester_id == user_id,
            FriendshipRequest.status == status,
        ).order_by(FriendshipRequest.created_at.desc())
    )

    requests = []
    for req in list(received.scalars().all()) + list(sent.scalars().all()):
        # 获取发起者名称
        req_user_result = await db.execute(select(User).where(User.id == req.requester_id))
        req_user = req_user_result.scalar_one_or_none()
        requester_name = req_user.username if req_user else f"用户:{req.requester_id}"

        # 获取目标名称（发出的申请用）
        target_name = None
        if req.requester_id == user_id:
            if req.target_type == "human":
                tgt_result = await db.execute(select(User).where(User.id == req.target_id))
                tgt = tgt_result.scalar_one_or_none()
                target_name = tgt.username if tgt else None
            elif req.target_type == "ai":
                tgt_result = await db.execute(select(Agent).where(Agent.id == req.target_id))
                tgt = tgt_result.scalar_one_or_none()
                target_name = tgt.name if tgt else None

        requests.append({
            "id": req.id,
            "requester_id": req.requester_id,
            "requester_name": requester_name,
            "target_type": req.target_type,
            "target_id": req.target_id,
            "target_name": target_name,
            "status": req.status,
            "message": req.message,
            "direction": "received" if req.target_id == user_id else "sent",
            "created_at": str(req.created_at) if req.created_at else None,
            "resolved_at": str(req.resolved_at) if req.resolved_at else None,
        })

    return requests


async def search_entities(
    db: AsyncSession,
    query: str,
    current_user_id: int,
    limit: int = 20,
) -> list[dict]:
    """搜索用户和 AI"""
    from app.models.user import User
    from app.models.agent import Agent
    from app.models.friendship import Friendship

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
        # 检查是否已是好友
        is_friend = await _is_friend(db, current_user_id, "human", user.id)
        results.append({
            "id": user.id,
            "type": "human",
            "name": user.username,
            "owner_name": None,
            "is_friend": is_friend,
            "state": None,
        })

    # 搜索 AI
    agent_result = await db.execute(
        select(Agent).where(
            Agent.name.ilike(like_pattern),
        ).limit(limit)
    )
    for agent in agent_result.scalars().all():
        owner_result = await db.execute(select(User).where(User.id == agent.owner_id))
        owner = owner_result.scalar_one_or_none()
        is_friend = await _is_friend(db, current_user_id, "ai", agent.id)
        results.append({
            "id": agent.id,
            "type": "ai",
            "name": agent.name,
            "owner_name": owner.username if owner else None,
            "is_friend": is_friend,
            "state": agent.state,
        })

    # 限制总结果数
    return results[:limit]



# ============================================================
# 内部工具函数
# ============================================================

async def _get_request(db: AsyncSession, request_id: int):
    from app.models.friendship import FriendshipRequest
    result = await db.execute(
        select(FriendshipRequest).where(FriendshipRequest.id == request_id)
    )
    return result.scalar_one_or_none()


async def _find_reverse_request(
    db: AsyncSession,
    requester_id: int,
    target_type: str,
    target_id: int,
):
    """查找对方是否已向当前发起者发送过待处理的好友申请

    requester_id: 当前发起者的 users.id
    target_type/target_id: 当前发起的目标（human=users.id, ai=agents.id）

    返回: 匹配的 reverse FriendshipRequest 或 None
    """
    from app.models.friendship import FriendshipRequest
    from app.models.agent import Agent as AgentModel

    # 解析目标实体的 user_id（用于查找对方发出的申请）
    if target_type == "human":
        target_user_id = target_id
    else:
        # AI: 查 agents 表获取 user_id
        agent_result = await db.execute(
            select(AgentModel.user_id).where(AgentModel.id == target_id)
        )
        target_user_id = agent_result.scalar_one_or_none()

    if target_user_id is None:
        return None

    # 获取对方发出的所有 pending 申请
    sent_result = await db.execute(
        select(FriendshipRequest).where(
            FriendshipRequest.requester_id == target_user_id,
            FriendshipRequest.status == "pending",
        )
    )
    for req in sent_result.scalars().all():
        # 检查对方的申请目标是否匹配当前发起者
        if req.target_type == "human" and req.target_id == requester_id:
            return req
        if req.target_type == "ai":
            # 对方申请目标是个 AI，查其 user_id 是否匹配 requester_id
            ai_result = await db.execute(
                select(AgentModel.user_id).where(AgentModel.id == req.target_id)
            )
            ai_user_id = ai_result.scalar_one_or_none()
            if ai_user_id == requester_id:
                return req

    return None


async def _is_friend(db: AsyncSession, user_id: int, friend_type: str, friend_id: int) -> bool:
    from app.models.friendship import Friendship
    result = await db.execute(
        select(Friendship).where(
            Friendship.user_id == user_id,
            Friendship.friend_type == friend_type,
            Friendship.friend_id == friend_id,
        )
    )
    return result.scalar_one_or_none() is not None
