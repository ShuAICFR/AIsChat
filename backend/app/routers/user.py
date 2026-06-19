"""
用户设置路由
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from app.database import get_db
from app.services.auth_service import update_user_settings
from app.utils.auth import get_current_user
from app.schemas.auth import UserInfoResponse

router = APIRouter(prefix="/user", tags=["用户设置"])


class UpdateSettingsRequest(BaseModel):
    """更新用户设置请求"""
    api_base_url: str | None = None
    api_key: str | None = None
    auto_approve_vector_timeout: int | None = None
    auto_approve_vector_default: bool | None = None
    timezone: str | None = None
    language: str | None = None
    ui_prefs: str | None = None


class RedeemRequest(BaseModel):
    """兑换码请求"""
    code: str = Field(..., min_length=1, max_length=32)


@router.put("/settings", response_model=UserInfoResponse)
async def update_settings(
    req: UpdateSettingsRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新用户设置（API Key、策略模式等）"""
    try:
        return await update_user_settings(
            db,
            user_id=current_user["user_id"],
            api_base_url=req.api_base_url,
            api_key=req.api_key,
            auto_approve_vector_timeout=req.auto_approve_vector_timeout,
            auto_approve_vector_default=req.auto_approve_vector_default,
            timezone=req.timezone,
            language=req.language,
            ui_prefs=req.ui_prefs,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/redeem")
async def redeem_code(
    req: RedeemRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """使用兑换码增加 AI 创建额度"""
    from sqlalchemy import select
    from datetime import datetime, timezone
    from app.models.user import User
    from app.models.redemption import RedemptionCode

    # 查找兑换码
    result = await db.execute(
        select(RedemptionCode).where(RedemptionCode.code == req.code)
    )
    code_obj = result.scalar_one_or_none()

    if code_obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="兑换码无效")

    if code_obj.used_by is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="兑换码已被使用")

    if code_obj.expires_at and code_obj.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="兑换码已过期")

    # 增加额度（按类型加到不同字段）
    user_result = await db.execute(select(User).where(User.id == current_user["user_id"]))
    user = user_result.scalar_one()
    code_type = code_obj.code_type or "ai_quota"
    if code_type == "api_credit":
        user.api_credit += code_obj.quota_amount
        msg = f"兑换成功，获得 {code_obj.quota_amount} API 调用额度"
        current_amount = user.api_credit
    else:
        user.ai_quota += code_obj.quota_amount
        msg = f"兑换成功，获得 {code_obj.quota_amount} AI 创建额度"
        current_amount = user.ai_quota

    # 标记兑换码已使用
    code_obj.used_by = current_user["user_id"]
    code_obj.used_at = datetime.now(timezone.utc)

    await db.flush()

    return {
        "message": msg,
        "current_quota": user.ai_quota,
        "current_api_credit": user.api_credit,
    }
