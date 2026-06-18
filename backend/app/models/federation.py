"""
联邦通信 ORM 模型（v1.2.0 跨实例联邦通信）
"""
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey, func,
    CheckConstraint, UniqueConstraint,
)
from app.database import Base


class InstanceConfig(Base):
    """实例身份配置（单例表，仅一行）"""
    __tablename__ = "instance_config"

    id = Column(Integer, primary_key=True, default=1)
    instance_id = Column(String(36), unique=True, nullable=False)  # 子网 UUID v4
    public_id = Column(String(50), unique=True, nullable=True)      # 公网 ID: AIsChat-xxxxxxxx
    display_name = Column(String(100), default="")                   # 人类可读名称
    public_url = Column(String(500), default="")                     # 本实例公网可达 URL
    github_token_encrypted = Column(String, nullable=True)           # Fernet 加密的 GitHub Token（前端配置，无需 SSH）
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now())


class FederationPeer(Base):
    """联邦对等端（其他 AIsChat 实例）"""
    __tablename__ = "federation_peers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    peer_public_id = Column(String(50), nullable=False)  # 对方公网 ID
    display_name = Column(String(100), default="")
    remote_url = Column(String(500), nullable=False)      # ws://host:port/federation/ws
    shared_secret_encrypted = Column(String, nullable=False)  # Fernet 加密的共享密钥
    is_enabled = Column(Boolean, default=True)
    connection_state = Column(String(20), default="disconnected")  # connecting|connected|disconnected|failed
    last_connected_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "connection_state IN ('connecting', 'connected', 'disconnected', 'failed')",
            name="ck_peer_connection_state",
        ),
    )


class FederationGroupShare(Base):
    """联邦群聊共享（哪个本地群与哪个对等端共享）"""
    __tablename__ = "federation_group_shares"

    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    peer_id = Column(Integer, ForeignKey("federation_peers.id", ondelete="CASCADE"), nullable=False)
    is_enabled = Column(Boolean, default=True)
    remote_group_id = Column(Integer, nullable=True)  # 远端群 ID（握手后填充）
    share_direction = Column(String(20), default="bidirectional")  # outgoing|incoming|bidirectional
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "share_direction IN ('outgoing', 'incoming', 'bidirectional')",
            name="ck_share_direction",
        ),
        UniqueConstraint("group_id", "peer_id", name="uq_group_peer"),
    )
