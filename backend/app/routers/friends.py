"""
好友系统路由
搜索、好友申请、好友列表管理
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.schemas.friendship import (
    FriendRequestCreate, FriendRequestResponse,
    FriendResponse, SearchResponse, SearchResult,
)
from app.services.friend_service import (
    send_friend_request, accept_friend_request, reject_friend_request,
    remove_friend, list_friends, list_friend_requests, search_entities,
)
from app.utils.auth import get_current_user

router = APIRouter(tags=["好友"])


@router.get("/search", response_model=SearchResponse)
async def search(
    q: str = Query(..., min_length=1, description="搜索关键词"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """搜索用户和 AI（支持按用户名/AI名搜索）"""
    results = await search_entities(db, q, current_user["user_id"])
    return {"results": results, "query": q}


@router.get("/friends", response_model=list[FriendResponse])
async def list_my_friends(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取我的好友列表"""
    return await list_friends(db, current_user["user_id"], limit=limit, offset=offset)


@router.post("/friends/requests", status_code=status.HTTP_201_CREATED)
async def create_friend_request(
    req: FriendRequestCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """发送好友申请"""
    try:
        result = await send_friend_request(
            db,
            requester_id=current_user["user_id"],
            target_type=req.target_type,
            target_id=req.target_id,
            message=req.message,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/friends/requests", response_model=list[FriendRequestResponse])
async def list_requests(
    status_filter: str = Query("pending", description="pending | accepted | rejected"),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取我的好友申请（收到 + 发出的）"""
    return await list_friend_requests(db, current_user["user_id"], status=status_filter)


@router.post("/friends/requests/{request_id}/accept")
async def accept_request(
    request_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """接受好友申请"""
    try:
        return await accept_friend_request(db, request_id, current_user["user_id"])
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/friends/requests/{request_id}/reject")
async def reject_request(
    request_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """拒绝好友申请"""
    try:
        return await reject_friend_request(db, request_id, current_user["user_id"])
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/friends/{friend_type}/{friend_id}")
async def delete_friend(
    friend_type: str,
    friend_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除好友"""
    if friend_type not in ("human", "ai"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无效的好友类型")
    try:
        return await remove_friend(db, current_user["user_id"], friend_type, friend_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ⚠️ 旧版 POST /dm/{friend_type}/{friend_id} 已移除（v1.1.2 统一 ID 后不再使用）。
# 移除原因：该路由与 dm.py 的 POST /dm/{session_id}/dnd 冲突——
#   FastAPI 将 "dnd" 当作 friend_id 的 int 参数解析，导致 422 错误。
# 私信请使用 POST /dm/{target_user_id}（见 dm.py）。
# 新增 /dm/ 子路由时注意：friends.router 先于 dm.router 注册，任何模糊匹配都会优先命中 friends 的路由。
