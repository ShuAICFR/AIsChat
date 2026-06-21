"""
联邦通信 Schema（v0.3.0 跨实例联邦通信）
"""
from pydantic import BaseModel, Field


# ── 实例身份 ──

class InstanceConfigResponse(BaseModel):
    """本实例身份信息"""
    instance_id: str
    public_id: str | None = None
    display_name: str = ""
    public_url: str = ""
    created_at: str | None = None
    updated_at: str | None = None


class InstanceConfigUpdate(BaseModel):
    """更新实例身份"""
    display_name: str | None = None
    public_url: str | None = None
    public_id: str | None = None


# ── 对等端 ──

class PeerCreate(BaseModel):
    """添加对等端"""
    peer_public_id: str = Field(..., min_length=1, max_length=50, description="对方公网 ID")
    display_name: str = Field(default="", max_length=100)
    remote_url: str = Field(..., min_length=1, max_length=500, description="ws://host:port/federation/ws")
    shared_secret: str = Field(..., min_length=8, description="共享密钥（明文，服务端加密存储）")


class PeerUpdate(BaseModel):
    """更新对等端"""
    display_name: str | None = None
    remote_url: str | None = None
    shared_secret: str | None = Field(default=None, min_length=8)
    is_enabled: bool | None = None


class PeerResponse(BaseModel):
    """对等端响应（不含密钥明文）"""
    id: int
    peer_public_id: str
    display_name: str
    remote_url: str
    is_enabled: bool
    connection_state: str
    last_connected_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


# ── 群聊共享 ──

class GroupShareCreate(BaseModel):
    """设置群聊联邦共享"""
    peer_id: int
    share_direction: str = Field(default="bidirectional", description="outgoing | incoming | bidirectional")


class GroupShareResponse(BaseModel):
    """群聊共享信息"""
    id: int
    group_id: int
    peer_id: int
    peer_public_id: str | None = None
    peer_display_name: str | None = None
    is_enabled: bool
    remote_group_id: int | None = None
    conversation_uuid: str | None = None
    share_direction: str
    created_at: str | None = None


# -- DM 联邦共享 --

class DMShareCreate(BaseModel):
    """设置私信联邦共享"""
    peer_id: int
    share_direction: str = Field(default="bidirectional", description="outgoing | incoming | bidirectional")


class DMShareResponse(BaseModel):
    """私信联邦共享信息"""
    id: int
    session_id: str
    peer_id: int
    peer_public_id: str | None = None
    peer_display_name: str | None = None
    is_enabled: bool
    conversation_uuid: str | None = None
    share_direction: str
    created_at: str | None = None


# ── 注册表 ──

class RegistryEntry(BaseModel):
    """GitHub 注册表中的单个实例条目"""
    public_id: str
    display_name: str
    public_url: str = ""
    registered_at: str | None = None
    contact: str = ""


class FederationRegistry(BaseModel):
    """GitHub 公开注册表"""
    version: int
    updated_at: str
    instances: dict[str, RegistryEntry]
