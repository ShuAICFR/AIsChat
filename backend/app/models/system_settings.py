"""
平台全局系统设置 — 单行表（id=1）
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB
from app.database import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, default=1)
    default_language = Column(String(10), default="en")
    default_platform_credit = Column(Integer, default=0, comment="全局默认平台赠送额度（0=禁用）")

    federation_sync_interval_minutes = Column(Integer, default=720, comment="联邦 profile 同步间隔（分钟），默认 720（12小时）")

    orphan_retention_days = Column(Integer, default=7, comment="孤儿文件宽限期（天），到期自动物理删除")

    system_prompt_overrides = Column(JSONB, nullable=True, comment="系统提示词覆盖（管理员自定义 core_identity/protocols 等段）")
    system_prompt_order = Column(JSONB, nullable=True, comment="系统提示词段拼接顺序（NULL=使用代码默认 SEGMENT_ORDER）")

    updated_by = Column(Integer, ForeignKey("users.id"))
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
