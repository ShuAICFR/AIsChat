"""
兑换码模型
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from app.database import Base


class RedemptionCode(Base):
    __tablename__ = "redemption_codes"

    code = Column(String(32), primary_key=True)
    quota_amount = Column(Integer, nullable=False)
    code_type = Column(String(10), default="ai_quota")  # 'ai_quota' | 'api_credit'
    expires_at = Column(DateTime)
    used_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    used_at = Column(DateTime)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
