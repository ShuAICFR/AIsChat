"""
用户设置路由
"""
import httpx
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
    ui_prefs: dict | None = None


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


class TestApiBody(BaseModel):
    api_base_url: str | None = None
    api_key: str | None = None


@router.post("/test-api-connection")
async def test_api_connection(
    req: TestApiBody,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """测试 API 连接（服务端代理，避免浏览器 CORS 限制）"""
    import logging
    logger = logging.getLogger(__name__)

    base_url = req.api_base_url or "https://api.deepseek.com"
    key = req.api_key

    # 如果没传 key，尝试从数据库读取
    if not key:
        from sqlalchemy import select
        from app.models.user import User
        result = await db.execute(select(User).where(User.id == current_user["user_id"]))
        user = result.scalar_one_or_none()
        if user and user.api_key_encrypted:
            from app.utils.crypto import decrypt_api_key
            key = decrypt_api_key(user.api_key_encrypted)

    if not key:
        raise HTTPException(status_code=400, detail="请先配置 API Key")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{base_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {key}"},
            )
            if resp.status_code == 200:
                data = resp.json()
                model_count = len(data.get("data", []))
                return {"ok": True, "message": f"连接成功，{model_count} 个模型可用"}
            else:
                return {"ok": False, "message": f"API 返回 {resp.status_code}: {resp.text[:200]}"}
    except httpx.ConnectError:
        return {"ok": False, "message": "无法连接到 API 服务器，请检查 Base URL"}
    except httpx.TimeoutException:
        return {"ok": False, "message": "连接超时，请检查网络或 API 地址"}
    except Exception as e:
        return {"ok": False, "message": f"连接失败: {str(e)}"}
