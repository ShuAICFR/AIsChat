"""
文件元数据模型
"""
from sqlalchemy import (
    Column, Integer, String, BigInteger, DateTime, func, CheckConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from app.database import Base


class FileMetadata(Base):
    __tablename__ = "file_metadata"

    id = Column(Integer, primary_key=True, autoincrement=True)
    path = Column(String, nullable=False)
    owner_type = Column(String(10), nullable=False)  # 'ai' | 'group' | 'system'
    owner_id = Column(Integer, nullable=False)
    size = Column(BigInteger)
    mime_type = Column(String(100))
    permissions = Column(JSONB)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "owner_type IN ('ai', 'group', 'system')",
            name="ck_file_owner_type",
        ),
    )
