"""
邮箱验证码模型
用于注册、登录、换绑邮箱时的验证码存储
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, func
from app.database import Base


class VerificationCode(Base):
    __tablename__ = "verification_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), nullable=False, index=True)
    code = Column(String(10), nullable=False, comment="6 位数字验证码")
    purpose = Column(String(30), nullable=False, comment="register / login / rebind")
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, default=False)
    ip_address = Column(String(45), nullable=True, comment="请求者 IP（用于频率限制）")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
