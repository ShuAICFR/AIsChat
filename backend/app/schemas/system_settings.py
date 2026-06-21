"""
系统设置 Pydantic Schema
"""
from pydantic import BaseModel, Field


class SystemSettingsResponse(BaseModel):
    """系统设置（公开）"""
    id: int
    default_language: str
    default_platform_credit: int = 0
    updated_by: int | None = None
    updated_at: str | None = None


class UpdateSystemSettingsRequest(BaseModel):
    """管理后台更新系统设置"""
    default_language: str | None = Field(None, description="全局默认语言: zh 或 en")
    default_platform_credit: int | None = Field(None, ge=0, description="全局默认平台赠送额度")


class SetupCompleteRequest(BaseModel):
    """完成初始化设置"""
    language: str = Field("zh", description="用户选择的语言: zh 或 en")
