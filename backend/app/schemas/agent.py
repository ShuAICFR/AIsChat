"""
AI 代理相关的 Pydantic 模型
"""
from pydantic import BaseModel, Field


class AgentCreateRequest(BaseModel):
    """创建 AI 请求"""
    name: str = Field(..., min_length=1, max_length=50)
    system_prompt: str | None = None
    temperature: float = Field(default=0.8, ge=0, le=2.0)
    top_p: float = Field(default=0.9, ge=0, le=1.0)
    presence_penalty: float = Field(default=0.5, ge=-2.0, le=2.0)
    frequency_penalty: float = Field(default=0.5, ge=-2.0, le=2.0)
    chat_model: str | None = None  # NULL = 继承全局
    work_model: str | None = None
    thinking_enabled: bool = Field(default=False)
    hide_ai_identity: bool = Field(default=False)
    config_profile: str | None = Field(default=None, description="预设档位: chat|immersive|digital_life，不填=custom")
    api_credit_cost: int = Field(default=0, ge=0, le=100000)


class AgentGenerateRequest(BaseModel):
    """AI 辅助生成性格请求"""
    description: str = Field(..., min_length=5, max_length=2000, description="描述你想要的 AI 性格")


class AgentGenerateResponse(BaseModel):
    """AI 辅助生成性格响应"""
    name: str
    system_prompt: str
    temperature: float
    top_p: float
    presence_penalty: float
    frequency_penalty: float


class AgentUpdateConfigRequest(BaseModel):
    """AI 自修改配置请求"""
    system_prompt: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2.0)
    top_p: float | None = Field(default=None, ge=0, le=1.0)
    presence_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    frequency_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    chat_model: str | None = None
    work_model: str | None = None
    thinking_enabled: bool | None = None
    hide_ai_identity: bool | None = None
    config_profile: str | None = None
    avatar_url: str | None = None
    api_base_url: str | None = None
    api_key: str | None = None


class AgentStateRequest(BaseModel):
    """切换状态请求"""
    target_state: str = Field(..., description="active|dnd|offline|blocked")
    duration_hours: int | None = Field(default=None, ge=1, le=72)
    reason: str | None = None


class AgentResponse(BaseModel):
    """AI 代理响应"""
    id: int
    owner_id: int
    name: str
    original_system_prompt: str | None
    original_temperature: float
    original_top_p: float
    original_presence_penalty: float
    original_frequency_penalty: float
    current_system_prompt: str | None
    current_temperature: float | None
    current_top_p: float | None
    current_presence_penalty: float | None
    current_frequency_penalty: float | None
    chat_model: str | None
    work_model: str | None
    state: str
    offline_until: str | None
    is_ai_editable: bool
    thinking_enabled: bool
    config_profile: str | None = None
    created_at: str | None


class AgentConfigHistoryResponse(BaseModel):
    """配置历史响应"""
    id: int
    agent_id: int
    system_prompt: str | None
    temperature: float | None
    top_p: float | None
    presence_penalty: float | None
    frequency_penalty: float | None
    created_at: str | None


class ApplyPresetRequest(BaseModel):
    """应用配置档请求"""
    profile: str = Field(..., description="chat|immersive|digital_life")


class WorkspaceFileUpdate(BaseModel):
    """更新工作区文件"""
    file: str = Field(..., description="todo|plan|journal")
    content: str = Field(..., description="新内容")


class WorkspaceResponse(BaseModel):
    """工作区响应"""
    todo: str = ""
    plan: str = ""
    journal: str = ""
