"""
群聊相关的 Pydantic 模型
"""
from pydantic import BaseModel, Field


class GroupCreateRequest(BaseModel):
    """创建群聊请求"""
    name: str = Field(..., min_length=1, max_length=100)
    initial_members: list[dict] | None = None  # [{"type": "ai", "id": 1}, ...]


class GroupInviteRequest(BaseModel):
    """邀请成员请求"""
    member_type: str = Field(..., description="human | ai")
    member_id: int


class GroupResponse(BaseModel):
    """群聊响应"""
    id: int
    name: str
    owner_type: str
    owner_id: int
    is_vector_accelerated: bool
    created_at: str | None


class GroupMemberResponse(BaseModel):
    """群成员响应"""
    group_id: int
    member_type: str
    member_id: int
    role: str
    dnd_until: str | None = None
    joined_at: str | None


class SetDndRequest(BaseModel):
    """设置群聊免打扰请求"""
    group_id: int = Field(..., description="群聊 ID")
    duration_minutes: int | None = Field(default=None, description="免打扰时长（分钟），0 或 null 表示永久")


class UnreadSummaryItem(BaseModel):
    """单个群聊的未读摘要"""
    group_id: int
    group_name: str
    unread_count: int
    last_message_preview: str
    last_message_at: str | None = None


class UnreadSummaryResponse(BaseModel):
    """未读消息摘要响应"""
    agent_id: int
    groups: list[UnreadSummaryItem]
