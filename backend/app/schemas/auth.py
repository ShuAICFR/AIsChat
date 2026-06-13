"""
认证相关的 Pydantic 模型
"""
from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    """注册请求"""
    username: str = Field(..., min_length=2, max_length=50, description="用户名")
    password: str = Field(..., min_length=6, max_length=100, description="密码")


class LoginRequest(BaseModel):
    """登录请求"""
    username: str = Field(..., description="用户名")
    password: str = Field(..., description="密码")


class TokenResponse(BaseModel):
    """JWT 令牌响应"""
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str
    role: str


class UserInfoResponse(BaseModel):
    """用户信息响应"""
    id: int
    username: str
    role: str
    is_active: bool
    ai_quota: int
    api_base_url: str | None = None
    has_api_key: bool = False  # 不返回明文 key，只返回是否已设置
    auto_approve_vector_timeout: int
    auto_approve_vector_default: bool
    timezone: str = "Asia/Shanghai"
    created_at: str | None = None
