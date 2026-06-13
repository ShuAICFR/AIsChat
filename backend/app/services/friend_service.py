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
    if target_type == "human":
        reverse_req = await db.execute(
            select(FriendshipRequest).where(
                FriendshipRequest.requester_id == target_id,
                FriendshipRequest.target_type == "human",
                FriendshipRequest.target_id == requester_id,
                FriendshipRequest.status == "pending",
            )
        )
        reverse = reverse_req.scalar_one_or_none()
        if reverse:
            # 自动接受对方的申请
            reverse.status = "accepted"
            reverse.resolved_at = datetime.now(timezone.utc)
            # 双向添加好友
            db.add(Friendship(user_id=requester_id, friend_type="human", friend_id=target_id))
            db.add(Friendship(user_id=target_id, friend_type="human", friend_id=requester_id))
            await db.flush()
            return {"status": "accepted", "auto": True, "message": "对方已向你发送申请，已自动成为好友"}

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
    req.resolved_at = datetime.now(timezone.utc)

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
    req.resolved_at = datetime.now(timezone.utc)

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
        if f.friend_type == "human":
            user_result = await db.execute(select(User).where(User.id == f.friend_id))
            user = user_result.scalar_one_or_none()
            if user:
                name = user.username
        elif f.friend_type == "ai":
            agent_result = await db.execute(select(Agent).where(Agent.id == f.friend_id))
            agent = agent_result.scalar_one_or_none()
            if agent:
                name = agent.name
                state = agent.state

        friends.append({
            "id": f.id,
            "friend_type": f.friend_type,
            "friend_id": f.friend_id,
            "friend_name": name,
            "state": state,
            "created_at": str(f.created_at) if f.created_at else None,
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

        requests.append({
            "id": req.id,
            "requester_id": req.requester_id,
            "requester_name": requester_name,
            "target_type": req.target_type,
            "target_id": req.target_id,
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


async def get_or_create_dm_group(
    db: AsyncSession,
    user_id: int,
    friend_type: str,
    friend_id: int,
) -> dict:
    """创建或获取与好友的私信群聊"""
    from app.models.friendship import Friendship
    from app.models.group import Group, GroupMember
    from app.models.user import User as UserModel
    from app.models.agent import Agent as AgentModel

    # 验证好友关系
    friend_check = await db.execute(
        select(Friendship).where(
            Friendship.user_id == user_id,
            Friendship.friend_type == friend_type,
            Friendship.friend_id == friend_id,
        )
    )
    if friend_check.scalar_one_or_none() is None:
        raise ValueError("还不是好友，无法私信")

    # 获取好友名称
    if friend_type == "human":
        u = await db.execute(select(UserModel).where(UserModel.id == friend_id))
        friend_user = u.scalar_one_or_none()
        friend_name = friend_user.username if friend_user else f"用户{friend_id}"
    else:
        a = await db.execute(select(AgentModel).where(AgentModel.id == friend_id))
        friend_agent = a.scalar_one_or_none()
        friend_name = friend_agent.name if friend_agent else f"AI{friend_id}"

    # 获取当前用户名
    my_result = await db.execute(select(UserModel).where(UserModel.id == user_id))
    me = my_result.scalar_one_or_none()
    my_name = me.username if me else f"用户{user_id}"

    # 查找已有 DM 群聊：双方都是 member 且 member_count=2 的群
    from sqlalchemy import func, and_ as sa_and
    existing = await db.execute(
        select(Group).where(
            Group.name.like(f"DM:%"),
            Group.id.in_(
                select(GroupMember.group_id).where(
                    sa_and(
                        GroupMember.member_type == "human",
                        GroupMember.member_id == user_id,
                    )
                )
            ),
            Group.id.in_(
                select(GroupMember.group_id).where(
                    sa_and(
                        GroupMember.member_type == friend_type,
                        GroupMember.member_id == friend_id,
                    )
                )
            ),
        )
    )
    dm_group = existing.scalars().first()

    if dm_group:
        return {
            "group_id": dm_group.id,
            "group_name": dm_group.name,
            "is_new": False,
        }

    # 创建新 DM 群聊
    dm_name = f"DM: {my_name} ↔ {friend_name}"
    group = Group(name=dm_name, owner_type="human", owner_id=user_id)
    db.add(group)
    await db.flush()

    # 添加双方为成员
    db.add(GroupMember(group_id=group.id, member_type="human", member_id=user_id, role="owner"))
    db.add(GroupMember(group_id=group.id, member_type=friend_type, member_id=friend_id, role="member"))
    await db.flush()

    logger.info(f"创建 DM 群聊: {dm_name} (group_id={group.id})")
    return {
        "group_id": group.id,
        "group_name": dm_name,
        "is_new": True,
    }


# ============================================================
# 内部工具函数
# ============================================================

async def _get_request(db: AsyncSession, request_id: int):
    from app.models.friendship import FriendshipRequest
    result = await db.execute(
        select(FriendshipRequest).where(FriendshipRequest.id == request_id)
    )
    return result.scalar_one_or_none()


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
