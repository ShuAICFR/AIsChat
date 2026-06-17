"""
Agent 闹钟模型
AI 可以为自己设定闹钟，到时间后自动唤醒并执行预设任务
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from app.database import Base


class AgentAlarm(Base):
    __tablename__ = "agent_alarms"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_id = Column(Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    wake_at = Column(DateTime(timezone=True), nullable=False, comment="唤醒时间")
    task = Column(Text, nullable=False, comment="唤醒后要执行的任务描述")
    status = Column(String(20), default="pending", comment="pending / fired / cancelled")
    created_at = Column(DateTime, default=None)
    fired_at = Column(DateTime(timezone=True), default=None, comment="实际触发时间")
