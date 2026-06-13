"""
摘要缓存模型
"""
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, func,
)
from app.database import Base


class UnreadSummaryCache(Base):
    """未读消息摘要缓存，key = agent_id + group_id，默认 10 分钟过期"""
    __tablename__ = "unread_summary_cache"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_id = Column(Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    summary_text = Column(Text, nullable=False)
    message_count = Column(Integer)
    last_message_at = Column(DateTime)
    cached_at = Column(DateTime, server_default=func.now())
    expires_at = Column(DateTime, nullable=False)
