"""
OpenCLI 相关的 Pydantic 模型
"""
from pydantic import BaseModel, Field


# ---------- 全局配置 ----------

class OpenCLIConfigUpdate(BaseModel):
    """更新全局 OpenCLI 配置"""
    global_enabled: bool | None = None
    default_rate_limit_per_minute: int | None = Field(default=None, ge=1, le=60)
    timeout_seconds: int | None = Field(default=None, ge=5, le=300)


class OpenCLIConfigResponse(BaseModel):
    """全局配置响应"""
    global_enabled: bool
    default_rate_limit_per_minute: int
    timeout_seconds: int


# ---------- AI 白名单 ----------

class AgentWhitelistUpdate(BaseModel):
    """更新某个 AI 的 OpenCLI 权限"""
    enabled: bool
    rate_limit_override: int | None = None  # NULL=继承全局


class AgentWhitelistItem(BaseModel):
    """AI OpenCLI 状态（列表用）"""
    agent_id: int
    agent_name: str
    owner_id: int
    enabled: bool
    rate_limit_override: int | None
    actual_rate_limit: int  # 实际生效的速率限制
    created_at: str | None = None


# ---------- 命令白名单 ----------

class CommandWhitelistCreate(BaseModel):
    """添加命令白名单"""
    pattern: str = Field(..., min_length=1, max_length=200)
    is_regex: bool = False
    description: str | None = Field(default=None, max_length=200)


class CommandWhitelistItem(BaseModel):
    """命令白名单条目"""
    id: int
    pattern: str
    is_regex: bool
    description: str | None
    enabled: bool
    created_at: str | None


# ---------- 执行请求 ----------

class OpenCLIExecuteRequest(BaseModel):
    """AI 调用 OpenCLI 的请求"""
    command: str = Field(..., min_length=1, max_length=100, description="OpenCLI 命令名")
    args: list[str] = Field(default_factory=list, description="命令参数列表")


class OpenCLIExecuteResponse(BaseModel):
    """OpenCLI 执行结果"""
    command: str
    args: list[str]
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int


# ---------- 使用日志 ----------

class UsageLogItem(BaseModel):
    """使用日志条目"""
    id: int
    agent_id: int | None
    command: str
    args: str | None
    exit_code: int | None
    stdout_truncated: str | None
    stderr_truncated: str | None
    duration_ms: int | None
    executed_at: str | None
