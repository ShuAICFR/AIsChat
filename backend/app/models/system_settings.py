"""
平台全局系统设置 — 单行表（id=1）
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from app.database import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, default=1)
    default_language = Column(String(10), default="en")
    default_platform_credit = Column(Integer, default=0, comment="全局默认平台赠送额度（0=禁用）")

    federation_sync_interval_minutes = Column(Integer, default=720, comment="联邦 profile 同步间隔（分钟），默认 720（12小时）")

    updated_by = Column(Integer, ForeignKey("users.id"))
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
