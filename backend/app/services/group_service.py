"""
群聊服务
处理群聊创建、成员管理、消息收发、免打扰、消息聚合等
"""
import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, and_, update
from app.models.group import Group, GroupMember
from app.models.message import Message, PendingMessage
from app.models.agent import Agent

logger = logging.getLogger(__name__)


async def create_group(
    db: AsyncSession,
    name: str,
    owner_type: str,
    owner_id: int,
    initial_members: list[dict] | None = None,
) -> Group:
    """创建群聊"""
    group = Group(
        name=name,
        owner_type=owner_type,
        owner_id=owner_id,
    )
    db.add(group)
    await db.flush()
    await db.refresh(group)

    # 添加群主为成员
    owner_member = GroupMember(
        group_id=group.id,
        member_type=owner_type,
        member_id=owner_id,
        role="owner",
    )
    db.add(owner_member)

    # 添加初始成员
    if initial_members:
        for member in initial_members:
            gm = GroupMember(
                group_id=group.id,
                member_type=member["type"],
                member_id=member["id"],
                role="member",
            )
            db.add(gm)

    await db.flush()
    logger.info(f"群聊 '{name}' (id={group.id}) 由 {owner_type}:{owner_id} 创建")
    return group


async def get_group(db: AsyncSession, group_id: int) -> Group | None:
    """获取群聊"""
    result = await db.execute(select(Group).where(Group.id == group_id))
    return result.scalar_one_or_none()


async def list_user_groups(db: AsyncSession, user_id: int) -> list[dict]:
    """列出用户所属的群聊"""
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.member_type == "human",
            GroupMember.member_id == user_id,
        )
    )
    memberships = result.scalars().all()

    groups = []
    for m in memberships:
        group = await get_group(db, m.group_id)
        if group:
            groups.append({
                "id": group.id,
                "name": group.name,
                "owner_type": group.owner_type,
                "owner_id": group.owner_id,
                "is_vector_accelerated": group.is_vector_accelerated,
                "my_role": m.role,
                "created_at": str(group.created_at) if group.created_at else None,
            })
    return groups


async def add_member(
    db: AsyncSession,
    group_id: int,
    member_type: str,
    member_id: int,
    role: str = "member",
) -> GroupMember:
    """添加群成员"""
    # 检查是否已在群中
    result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.member_type == member_type,
            GroupMember.member_id == member_id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise ValueError("该成员已在群聊中")

    member = GroupMember(
        group_id=group_id,
        member_type=member_type,
        member_id=member_id,
        role=role,
    )
    db.add(member)
    await db.flush()
    return member


async def get_group_members(db: AsyncSession, group_id: int) -> list[GroupMember]:
    """获取群成员列表"""
    result = await db.execute(
        select(GroupMember).where(GroupMember.group_id == group_id)
    )
    return list(result.scalars().all())


async def create_message(
    db: AsyncSession,
    group_id: int,
    sender_type: str,
    sender_id: int,
    content: str,
    reply_to: int | None = None,
) -> Message:
    """创建消息"""
    message = Message(
        group_id=group_id,
        sender_type=sender_type,
        sender_id=sender_id,
        content=content,
        reply_to=reply_to,
    )
    db.add(message)
    await db.flush()
    await db.refresh(message)
    return message


async def get_recent_messages(
    db: AsyncSession,
    group_id: int,
    limit: int = 20,
) -> list[Message]:
    """获取群聊最近消息"""
    result = await db.execute(
        select(Message)
        .where(Message.group_id == group_id)
        .order_by(desc(Message.created_at))
        .limit(limit)
    )
    return list(result.scalars().all())


def message_to_dict(message: Message, sender_name: str | None = None) -> dict:
    """将 Message ORM 对象转为字典"""
    return {
        "id": message.id,
        "group_id": message.group_id,
        "sender_type": message.sender_type,
        "sender_id": message.sender_id,
        "sender_name": sender_name,
        "content": message.content,
        "reply_to": message.reply_to,
        "created_at": str(message.created_at) if message.created_at else None,
    }


# ============================================================
# 免打扰 (DND) 相关
# ============================================================

async def set_group_dnd(
    db: AsyncSession,
    agent_id: int,
    group_id: int,
    duration_minutes: int | None = None,
) -> GroupMember:
    """
    为 AI 设置某个群聊的免打扰。
    - duration_minutes = 0 或 None → 永久免打扰 (dnd_until = 2099-12-31)
    - duration_minutes > 0 → 临时免打扰 (dnd_until = NOW() + interval)
    """
    from datetime import timezone as tz

    result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.member_type == "ai",
                GroupMember.member_id == agent_id,
            )
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise ValueError(f"AI {agent_id} 不在群聊 {group_id} 中")

    if duration_minutes is not None and duration_minutes > 0:
        member.dnd_until = datetime.utcnow() + timedelta(minutes=duration_minutes)
        logger.info(f"AI {agent_id} 在群聊 {group_id} 设置临时免打扰 {duration_minutes} 分钟")
    else:
        member.dnd_until = datetime(2099, 12, 31, 23, 59, 59)  # 永久免打扰
        logger.info(f"AI {agent_id} 在群聊 {group_id} 设置永久免打扰")

    await db.flush()
    return member


async def is_member_in_dnd(db: AsyncSession, agent_id: int, group_id: int) -> bool:
    """检查 AI 在指定群聊是否处于免打扰状态"""
    # 1. 先检查全局暂停
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    if agent and agent.is_paused:
        return True

    # 2. 再检查按群 DND
    result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.member_type == "ai",
                GroupMember.member_id == agent_id,
            )
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        return False

    # NULL = 未设置 DND，不在免打扰状态
    if member.dnd_until is None:
        return False

    # 有值 = 检查是否过期
    now = datetime.utcnow()
    return member.dnd_until > now


async def cancel_group_dnd(
    db: AsyncSession,
    agent_id: int,
    group_id: int,
) -> GroupMember:
    """取消 AI 在某个群聊的免打扰（设为正常接收消息）"""
    result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.member_type == "ai",
                GroupMember.member_id == agent_id,
            )
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise ValueError(f"AI {agent_id} 不在群聊 {group_id} 中")

    # 设为一个过去的时间表示正常状态
    member.dnd_until = datetime(2000, 1, 1, tzinfo=timezone.utc)
    await db.flush()
    logger.info(f"AI {agent_id} 在群聊 {group_id} 已取消免打扰")
    return member


# ============================================================
# 暂存消息 (Pending Messages)
# ============================================================

async def store_pending_message(
    db: AsyncSession,
    agent_id: int,
    group_id: int,
    message_id: int,
) -> PendingMessage:
    """将消息暂存到 AI 的 pending 列表"""
    pending = PendingMessage(
        agent_id=agent_id,
        group_id=group_id,
        message_id=message_id,
    )
    db.add(pending)
    await db.flush()
    await db.refresh(pending)
    return pending


async def get_pending_messages(
    db: AsyncSession,
    agent_id: int,
    group_id: int | None = None,
    unread_only: bool = True,
) -> list[dict]:
    """获取 AI 的暂存消息，可按群聊过滤"""
    query = select(PendingMessage, Message).join(
        Message, PendingMessage.message_id == Message.id
    ).where(PendingMessage.agent_id == agent_id)

    if unread_only:
        query = query.where(PendingMessage.is_read == False)
    if group_id is not None:
        query = query.where(PendingMessage.group_id == group_id)

    query = query.order_by(Message.created_at.asc())

    result = await db.execute(query)
    rows = result.all()

    return [
        {
            "pending_id": pm.id,
            "group_id": pm.group_id,
            "message_id": pm.message_id,
            "content": msg.content,
            "sender_type": msg.sender_type,
            "sender_id": msg.sender_id,
            "created_at": str(msg.created_at) if msg.created_at else None,
        }
        for pm, msg in rows
    ]


async def mark_pending_read(
    db: AsyncSession,
    agent_id: int,
    group_id: int | None = None,
):
    """标记暂存消息为已读"""
    query = (
        update(PendingMessage)
        .where(PendingMessage.agent_id == agent_id)
        .where(PendingMessage.is_read == False)
    )
    if group_id is not None:
        query = query.where(PendingMessage.group_id == group_id)

    query = query.values(is_read=True)
    await db.execute(query)
    await db.flush()


# ============================================================
# 消息聚合 / 暂停通知
# ============================================================

async def check_unread(
    db: AsyncSession,
    agent_id: int,
) -> list[dict]:
    """
    获取 AI 各群聊的未读消息摘要（按群分组）。
    返回: [{group_id, group_name, unread_count, last_message_preview, last_message_at}, ...]
    """
    from sqlalchemy import func as sqlfunc

    result = await db.execute(
        select(
            PendingMessage.group_id,
            sqlfunc.count(PendingMessage.id).label("unread_count"),
            sqlfunc.max(Message.created_at).label("last_message_at"),
        )
        .join(Message, PendingMessage.message_id == Message.id)
        .where(
            and_(
                PendingMessage.agent_id == agent_id,
                PendingMessage.is_read == False,
            )
        )
        .group_by(PendingMessage.group_id)
    )

    summaries = []
    for row in result:
        # 获取群聊名称
        group_result = await db.execute(select(Group).where(Group.id == row.group_id))
        group = group_result.scalar_one_or_none()
        group_name = group.name if group else f"群聊#{row.group_id}"

        # 获取最新一条消息作为预览
        latest = await db.execute(
            select(Message.content)
            .join(PendingMessage, PendingMessage.message_id == Message.id)
            .where(
                and_(
                    PendingMessage.agent_id == agent_id,
                    PendingMessage.group_id == row.group_id,
                    PendingMessage.is_read == False,
                )
            )
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        preview_row = latest.scalar_one_or_none()
        preview = preview_row[:100] if preview_row else "..."

        summaries.append({
            "group_id": row.group_id,
            "group_name": group_name,
            "unread_count": row.unread_count,
            "last_message_preview": preview,
            "last_message_at": str(row.last_message_at) if row.last_message_at else None,
        })

    return summaries


async def generate_llm_summary(
    agent_id: int,
    group_id: int,
    group_name: str,
    unread_count: int,
    last_message_preview: str,
    api_base_url: str = "https://api.deepseek.com",
    api_key: str | None = None,
) -> str:
    """
    调用 LLM 生成自然语言摘要。
    实际实现需接入 LLM API，此处为基础骨架。
    """
    if unread_count == 0:
        return f"群聊【{group_name}】没有新消息。"

    # 简单模板摘要（无 LLM 调用时使用）
    return (
        f"群聊【{group_name}】有 {unread_count} 条新消息，"
        f"最后一条：「{last_message_preview[:50]}」"
    )


async def pause_notifications(db: AsyncSession, agent_id: int) -> Agent:
    """暂停所有群聊的通知（任务期间暂存消息）"""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if agent is None:
        raise ValueError("AI 代理不存在")

    agent.is_paused = True
    await db.flush()
    logger.info(f"AI {agent_id} 已暂停通知，消息将暂存")
    return agent


async def resume_and_fetch(
    db: AsyncSession,
    agent_id: int,
) -> tuple[Agent, list[dict]]:
    """
    恢复通知，并返回暂停期间的所有暂存消息，标记为已读。
    返回: (agent, pending_messages_list)
    """
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if agent is None:
        raise ValueError("AI 代理不存在")

    if not agent.is_paused:
        raise ValueError("AI 代理未处于暂停状态")

    # 获取暂停期间的未读消息
    pending = await get_pending_messages(db, agent_id, unread_only=True)

    # 标记已读
    await mark_pending_read(db, agent_id)

    # 恢复
    agent.is_paused = False
    await db.flush()

    logger.info(f"AI {agent_id} 已恢复通知，返回 {len(pending)} 条暂存消息")
    return agent, pending
