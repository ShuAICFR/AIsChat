"""
群聊模型
"""
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, CheckConstraint, func,
    ForeignKey, PrimaryKeyConstraint,
)
from app.database import Base


class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    owner_type = Column(String(10), nullable=False)  # 'human' | 'ai'
    owner_id = Column(Integer, nullable=False)
    is_vector_accelerated = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "owner_type IN ('human', 'ai')",
            name="ck_group_owner_type",
        ),
    )


class GroupMember(Base):
    __tablename__ = "group_members"

    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    member_type = Column(String(10), nullable=False)  # 'human' | 'ai'
    member_id = Column(Integer, nullable=False)
    role = Column(String(20), default="member")  # owner|admin|member
    dnd_until = Column(DateTime, nullable=True)  # NULL=永久免打扰; 有值=临时截止时间
    joined_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        PrimaryKeyConstraint("group_id", "member_type", "member_id"),
        CheckConstraint(
            "member_type IN ('human', 'ai')",
            name="ck_group_member_type",
        ),
    )
