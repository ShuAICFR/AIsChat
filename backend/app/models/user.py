"""
用户模型
"""
from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, func
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="user")  # 'admin' | 'user'
    is_active = Column(Boolean, default=True)
    ai_quota = Column(Integer, default=3)

    # 策略模式设置
    auto_approve_vector_timeout = Column(Integer, default=60)
    auto_approve_vector_default = Column(Boolean, default=False)

    # API 配置（加密存储）
    api_base_url = Column(Text)
    api_key_encrypted = Column(Text)

    # 时区（IANA 格式，如 Asia/Shanghai）
    timezone = Column(String(50), default="Asia/Shanghai")

    # 用户类型：human / ai（统一 ID 空间，AI 通过 agent.user_id 关联）
    type = Column(String(10), default="human")

    created_at = Column(DateTime, server_default=func.now())
