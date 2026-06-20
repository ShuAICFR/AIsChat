"""
两层记忆模型
"""
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, func,
    CheckConstraint,
)
from pgvector.sqlalchemy import Vector
from app.database import Base


class RoughMemory(Base):
    """粗略记忆（标题层）"""
    __tablename__ = "rough_memories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_type = Column(String(10), nullable=False)  # 'ai' | 'group'
    owner_id = Column(Integer, nullable=False)
    title = Column(String(200), nullable=False)
    embedding = Column(Vector(1536))  # 标题向量
    scope = Column(String(10), default="private")  # private | group | cross_user
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    # v0.4.0: per-user 记忆隔离（共振 AI 为 NULL，通用/半通用填触发用户 ID）
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "owner_type IN ('ai', 'group')",
            name="ck_rough_owner_type",
        ),
    )


class DetailMemory(Base):
    """详细记忆（内容层）"""
    __tablename__ = "detail_memories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    rough_id = Column(Integer, ForeignKey("rough_memories.id", ondelete="CASCADE"), nullable=False)
    content = Column(Text, nullable=False)
    embedding = Column(Vector(1536))  # 可选，用于深度检索
    created_at = Column(DateTime, server_default=func.now())
