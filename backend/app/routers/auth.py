"""
认证路由
POST /auth/register, POST /auth/login, GET /auth/me
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, UserInfoResponse
from app.schemas.system_settings import SetupCompleteRequest
from app.services.auth_service import register_user, login_user, get_user_info, update_user_settings
from app.utils.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["认证"])


@router.get("/has-users")
async def has_users(db: AsyncSession = Depends(get_db)):
    """检查是否已有注册用户（公开接口，注册页用）"""
    count = (await db.execute(select(func.count(User.id)))).scalar()
    return {"has_users": count > 0}


@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """注册新用户。第一个注册的用户自动成为管理员。"""
    try:
        user = await register_user(db, req.username, req.password)
        # 注册后自动登录
        return await login_user(db, req.username, req.password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """用户登录，返回 JWT 令牌。"""
    try:
        return await login_user(db, req.username, req.password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))


@router.get("/me", response_model=UserInfoResponse)
async def me(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户信息。"""
    try:
        return await get_user_info(db, current_user["user_id"])
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/setup")
async def complete_setup(
    req: SetupCompleteRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """完成初始化设置向导"""
    if req.language not in ("zh", "en"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的语言")
    result = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    user.language = req.language
    user.setup_completed = True
    await db.flush()
    return {"status": "ok", "setup_completed": True}
