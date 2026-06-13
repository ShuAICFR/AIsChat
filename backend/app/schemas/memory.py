"""
记忆相关的 Pydantic 模型
"""
from pydantic import BaseModel, Field


class StoreMemoryRequest(BaseModel):
    """存储记忆请求"""
    title: str = Field(..., max_length=200)
    content: str = Field(...)
    scope: str = Field(default="private")  # private | group
    group_id: int | None = None


class RecallMemoryRequest(BaseModel):
    """检索记忆请求"""
    query: str = Field(...)
    scope: str = Field(default="private")
    group_id: int | None = None
    top_k: int = Field(default=5, ge=1, le=20)


class RoughMemoryResponse(BaseModel):
    """粗略记忆响应"""
    id: int
    title: str
    similarity: float | None = None
    created_at: str | None


class DetailMemoryResponse(BaseModel):
    """详细记忆响应"""
    id: int
    rough_id: int
    content: str
    created_at: str | None
