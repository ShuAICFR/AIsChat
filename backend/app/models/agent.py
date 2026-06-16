"""
AI 代理模型
"""
from sqlalchemy import (
    Column, Integer, String, Boolean, Float, Text, DateTime,
    ForeignKey, func,
)
from app.database import Base


class Agent(Base):
    __tablename__ = "agents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(50), nullable=False)

    # 原始配置（管理员设定，不可被 AI 覆盖）
    original_system_prompt = Column(Text)
    original_temperature = Column(Float, default=0.8)
    original_top_p = Column(Float, default=0.9)
    original_presence_penalty = Column(Float, default=0.5)
    original_frequency_penalty = Column(Float, default=0.5)

    # 当前配置（AI 可自修改）
    current_system_prompt = Column(Text)
    current_temperature = Column(Float)
    current_top_p = Column(Float)
    current_presence_penalty = Column(Float)
    current_frequency_penalty = Column(Float)

    # 模型选择（NULL = 继承全局默认）
    chat_model = Column(String(50))
    work_model = Column(String(50))

    # 状态机
    state = Column(String(20), default="active")  # active|dnd|offline|blocked
    offline_until = Column(DateTime)

    # 全局暂停通知（任务期间暂存所有群聊消息）
    is_paused = Column(Boolean, default=False)

    # 意愿评分 + 自动免打扰配置
    auto_dnd_threshold = Column(Integer, default=20)  # 低于此分自动开 DND
    auto_dnd_duration = Column(Integer, default=5)    # 自动 DND 时长（分钟）

    # 是否允许 AI 自修改
    is_ai_editable = Column(Boolean, default=True)

    # 深度推理模式（DeepSeek thinking），AI 可自行切换
    thinking_enabled = Column(Boolean, default=False)

    # AI 在 users 表中的身份（统一 ID 空间，用于私信等场景）
    user_id = Column(Integer, ForeignKey("users.id"))

    created_at = Column(DateTime, server_default=func.now())


class AgentConfigHistory(Base):
    """AI 配置历史记录（用于回滚）"""
    __tablename__ = "agent_config_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    agent_id = Column(Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)

    system_prompt = Column(Text)
    temperature = Column(Float)
    top_p = Column(Float)
    presence_penalty = Column(Float)
    frequency_penalty = Column(Float)

    created_at = Column(DateTime, server_default=func.now())
