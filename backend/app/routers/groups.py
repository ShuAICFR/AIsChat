"""
群聊与消息路由
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.schemas.group import (
    GroupCreateRequest, GroupInviteRequest, GroupResponse,
    SetDndRequest, UnreadSummaryItem, UnreadSummaryResponse,
)
from app.schemas.message import MessageResponse
from app.services.group_service import (
    create_group,
    get_group,
    list_user_groups,
    add_member,
    get_group_members,
    get_recent_messages,
    message_to_dict,
    set_group_dnd,
    cancel_group_dnd,
    is_member_in_dnd,
)
from app.utils.auth import get_current_user

router = APIRouter(tags=["群聊"])


@router.post("/groups", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_new_group(
    req: GroupCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建群聊"""
    try:
        group = await create_group(
            db,
            name=req.name,
            owner_type="human",
            owner_id=current_user["user_id"],
            initial_members=req.initial_members,
        )
        return {
            "id": group.id,
            "name": group.name,
            "owner_type": group.owner_type,
            "owner_id": group.owner_id,
            "is_vector_accelerated": group.is_vector_accelerated,
            "created_at": str(group.created_at) if group.created_at else None,
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/groups", response_model=list[GroupResponse])
async def list_my_groups(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取我的群聊列表"""
    groups = await list_user_groups(db, current_user["user_id"])
    return groups


@router.get("/groups/{group_id}", response_model=GroupResponse)
async def get_group_detail(
    group_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取群聊详情"""
    group = await get_group(db, group_id)
    if group is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="群聊不存在")
    return {
        "id": group.id,
        "name": group.name,
        "owner_type": group.owner_type,
        "owner_id": group.owner_id,
        "is_vector_accelerated": group.is_vector_accelerated,
        "created_at": str(group.created_at) if group.created_at else None,
    }


@router.post("/groups/{group_id}/invite")
async def invite_member(
    group_id: int,
    req: GroupInviteRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """邀请成员加入群聊"""
    try:
        member = await add_member(
            db,
            group_id=group_id,
            member_type=req.member_type,
            member_id=req.member_id,
        )
        return {"message": "邀请成功", "group_id": group_id}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/groups/{group_id}/members")
async def list_members(
    group_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取群成员列表"""
    members = await get_group_members(db, group_id)
    return [
        {
            "group_id": m.group_id,
            "member_type": m.member_type,
            "member_id": m.member_id,
            "role": m.role,
            "dnd_until": str(m.dnd_until) if m.dnd_until else None,
            "joined_at": str(m.joined_at) if m.joined_at else None,
        }
        for m in members
    ]


@router.get("/groups/{group_id}/messages", response_model=list[MessageResponse])
async def get_messages(
    group_id: int,
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取群聊消息历史"""
    from app.models.user import User
    from app.models.agent import Agent

    messages = await get_recent_messages(db, group_id, limit)

    # 批量解析发送者名称
    human_ids = {m.sender_id for m in messages if m.sender_type == "human"}
    ai_ids = {m.sender_id for m in messages if m.sender_type == "ai"}

    name_map: dict[tuple, str] = {}
    if human_ids:
        result = await db.execute(select(User).where(User.id.in_(human_ids)))
        for u in result.scalars().all():
            name_map[("human", u.id)] = u.username
    if ai_ids:
        result = await db.execute(select(Agent).where(Agent.id.in_(ai_ids)))
        for a in result.scalars().all():
            name_map[("ai", a.id)] = a.name

    return [
        message_to_dict(m, sender_name=name_map.get((m.sender_type, m.sender_id)))
        for m in reversed(messages)
    ]


@router.post("/groups/{group_id}/dnd")
async def set_dnd(
    group_id: int,
    req: SetDndRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    为当前用户（或其所拥有的 AI）在指定群聊设置免打扰。
    请求中的 group_id 会覆盖 body 中的 group_id。
    """
    try:
        actual_group_id = group_id
        member = await set_group_dnd(
            db,
            agent_id=current_user["user_id"],  # human 用户也可设 DND
            group_id=actual_group_id,
            duration_minutes=req.duration_minutes,
        )
        return {
            "message": "免打扰已设置",
            "group_id": actual_group_id,
            "dnd_until": str(member.dnd_until) if member.dnd_until else "永久",
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/groups/{group_id}/dnd/cancel")
async def cancel_dnd(
    group_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """取消指定群聊的免打扰"""
    try:
        await cancel_group_dnd(db, current_user["user_id"], group_id)
        return {"message": "免打扰已取消", "group_id": group_id}
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/groups/{group_id}/dnd/status")
async def check_dnd(
    group_id: int,
    agent_id: int = Query(..., description="AI ID"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """检查指定 AI 在群聊中是否处于免打扰状态"""
    in_dnd = await is_member_in_dnd(db, agent_id, group_id)
    return {"agent_id": agent_id, "group_id": group_id, "in_dnd": in_dnd}
