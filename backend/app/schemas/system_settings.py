"""
系统设置 Pydantic Schema
"""
from pydantic import BaseModel, Field


class SystemSettingsResponse(BaseModel):
    """系统设置（公开）"""
    id: int
    default_language: str
    default_platform_credit: int = 0
    default_file_quota_mb: int = 100
    updated_by: int | None = None
    updated_at: str | None = None
    login_providers: list[str] = ["direct"]
    require_email_verification: bool = False


class UpdateSystemSettingsRequest(BaseModel):
    """管理后台更新系统设置"""
    default_language: str | None = Field(None, description="全局默认语言: zh 或 en")
    default_platform_credit: int | None = Field(None, ge=0, description="全局默认平台赠送额度")
    default_file_quota_mb: int | None = Field(None, ge=1, description="新用户默认文件配额（MB），修改后所有用户同步调整")


class SetupCompleteRequest(BaseModel):
    """完成初始化设置"""
    language: str = Field("zh", description="用户选择的语言: zh 或 en")


# ── v1.0.0 邮箱认证 ──

class SmtpConfigRequest(BaseModel):
    """SMTP 配置请求"""
    host: str = Field(..., min_length=1, max_length=255)
    port: int = Field(..., ge=1, le=65535)
    username: str = Field(..., max_length=255)
    password: str | None = Field(None, description="留空保持现有密码不变")
    from_email: str = Field(..., max_length=255)
    from_name: str = Field("AIsChat", max_length=100)
    use_tls: bool = True


class AuthSettingsRequest(BaseModel):
    """认证设置请求"""
    require_email_verification: bool | None = Field(None)
    login_providers: list[str] | None = Field(None, min_length=1)


class AuthSettingsResponse(BaseModel):
    """认证设置完整响应（管理面板用）"""
    require_email_verification: bool = False
    login_providers: list[str] = ["direct"]
    smtp_configured: bool = False
    smtp_config: dict | None = None  # 密码已脱敏
