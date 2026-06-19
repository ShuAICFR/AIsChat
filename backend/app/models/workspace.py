"""
AI 个人工作区模型
追踪 AI 当前正在做什么、是否被打断、上次任务是什么。
这是 AI "内心独白"和"任务恢复"的基础设施。
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from app.database import Base


class AgentWorkspace(Base):
    __tablename__ = "agent_workspace"

    agent_id = Column(Integer, ForeignKey("agents.id", ondelete="CASCADE"), primary_key=True)
    current_task = Column(Text, nullable=True, comment="AI 当前正在做的任务描述")
    current_task_at = Column(DateTime, nullable=True, comment="任务开始时间")
    interrupted_at = Column(DateTime, nullable=True, comment="被中断的时间")
    interruption_reason = Column(Text, nullable=True, comment="中断原因（谁发消息打断了）")
    updated_at = Column(DateTime, nullable=True, comment="最后更新时间")

    # 个人工作区文件（路线图：个人工作区）
    todo = Column(Text, nullable=True, default="", comment="AI 的 TODO 列表（markdown）")
    plan = Column(Text, nullable=True, default="", comment="AI 的 PLAN 规划（markdown）")
    journal = Column(Text, nullable=True, default="", comment="AI 的 JOURNAL 日志（markdown，按日期追加）")
