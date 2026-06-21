"""
消息相关的 Pydantic 模型
"""
from pydantic import BaseModel, Field


class MessageResponse(BaseModel):
    """消息响应"""
    id: int
    group_id: int
    sender_type: str
    sender_id: int
    sender_name: str | None = None
    content: str
    reply_to: int | None = None
    attachments: list[dict] | None = None  # [{file_id, name, path, size, mime_type}, ...]
    created_at: str | None


class WebSocketMessage(BaseModel):
    """WebSocket 客户端消息"""
    type: str  # subscribe | send | typing
    group_id: int | None = None
    content: str | None = None
    reply_to: int | None = None
    is_typing: bool | None = None


class WebSocketServerMessage(BaseModel):
    """WebSocket 服务端推送消息"""
    type: str  # message | typing | state_change | error | unread_summary
    data: dict | None = None


class ToolCallError(BaseModel):
    """工具调用错误返回格式"""
    error: bool = True
    code: str
    message: str


class WebSocketErrorEvent(BaseModel):
    """WebSocket 异步错误事件"""
    type: str = "error"
    code: str
    message: str
    tool_call_id: str | None = None
