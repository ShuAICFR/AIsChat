"""
系统日志模型
"""
from sqlalchemy import Column, Integer, String, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB
from app.database import Base


class SystemLog(Base):
    __tablename__ = "system_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    log_type = Column(String(50))
    operator_type = Column(String(10))
    operator_id = Column(Integer)
    target_type = Column(String(50))  # ⚠️ 原 VARCHAR(10) 过短，'opencli_command' 15字符会报 value too long
    target_id = Column(Integer)
    details = Column(JSONB)
    created_at = Column(DateTime, server_default=func.now())
