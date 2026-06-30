"""
目录级结构记忆（双重记忆架构的系统2）

与 rough_memories（向量记忆）互补：
- 向量记忆：语义搜索，适合"我记不记得这个事实？"
- 结构记忆：精确键值存取，适合"学生1的有机化学水平是什么？"

目录结构：{category}/{sub_key}/{field} → value
UNIQUE(agent_id, category, sub_key, field) 实现 upsert
"""
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, func, UniqueConstraint,
)
from app.database import Base


class StructuredRecord(Base):
    __tablename__ = "structured_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_id = Column(Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    category = Column(String(100), nullable=False)
    sub_key = Column(String(200), nullable=False)
    field = Column(String(200), nullable=False)
    value = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("agent_id", "category", "sub_key", "field", name="uq_sr_path"),
    )
