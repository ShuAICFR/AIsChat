"""
应用配置模块
从环境变量读取配置，提供全局设置
"""
import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """全局应用配置"""

    # 数据库
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://ai_chat:change_me@localhost:5432/ai_group_chat",
    )
    database_url_sync: str = os.getenv(
        "DATABASE_URL_SYNC",
        "postgresql://ai_chat:change_me@localhost:5432/ai_group_chat",
    )

    # JWT
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "dev-secret-change-me")
    jwt_algorithm: str = "HS256"
    jwt_expire_days: int = 7

    # DeepSeek API 默认配置
    deepseek_base_url: str = os.getenv(
        "DEEPSEEK_BASE_URL", "https://api.deepseek.com"
    )
    default_chat_model: str = "deepseek-v4-flash"
    default_work_model: str = "deepseek-v4-pro"
    default_embedding_model: str = "deepseek-embed"

    # 文件存储
    data_dir: str = os.getenv("DATA_DIR", "/app/data")

    # 防滥用
    rate_limit_per_second: int = 2  # 每个 AI 每秒最多发言次数

    # 向量检索默认参数
    default_top_k: int = 10
    vector_weight: float = 0.6
    bm25_weight: float = 0.3
    time_decay_weight: float = 0.1

    # 意愿评分 + 自动免打扰全局默认
    default_auto_dnd_threshold: int = 20   # 意愿分数低于此值自动开 DND
    default_auto_dnd_duration: int = 5     # 自动 DND 时长（分钟）

    # 摘要缓存 TTL（秒）
    summary_cache_ttl: int = 600  # 10 分钟

    # OpenCLI 集成
    opencli_global_enabled: bool = False
    opencli_default_rate_limit: int = 5     # 每分钟最多 N 次
    opencli_timeout_seconds: int = 30       # 单个命令超时时间
    opencli_stdout_max_chars: int = 2000    # stdout 截断长度

    # 加密密钥（用于 API Key 加密存储）
    encryption_key: str = os.getenv(
        "ENCRYPTION_KEY", jwt_secret_key
    )  # 默认复用 JWT key

    class Config:
        env_file = ".env"
        extra = "allow"


settings = Settings()
