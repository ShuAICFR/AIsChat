"""
加密工具模块
使用 cryptography.fernet 加密用户的 API Key
"""
from cryptography.fernet import Fernet
import base64
import hashlib
from app.config import settings


def _get_fernet() -> Fernet:
    """从配置密钥生成 Fernet 实例"""
    # Fernet 要求 32 字节的 base64 编码密钥
    key = hashlib.sha256(settings.encryption_key.encode()).digest()
    fernet_key = base64.urlsafe_b64encode(key)
    return Fernet(fernet_key)


def encrypt_api_key(api_key: str) -> str:
    """加密 API Key"""
    fernet = _get_fernet()
    return fernet.encrypt(api_key.encode()).decode()


def decrypt_api_key(encrypted_key: str) -> str:
    """解密 API Key"""
    fernet = _get_fernet()
    return fernet.decrypt(encrypted_key.encode()).decode()
