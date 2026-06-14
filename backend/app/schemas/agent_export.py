"""
AI 灵魂档案（Soul Archive）导出/导入格式
"""


class AgentSoulArchive:
    """
    AI 角色灵魂档案 —— 导出/导入格式
    不使用 Pydantic BaseModel 以保持最大兼容性，
    导入时做宽松校验。
    """
    export_version: str = "1.0"
    exported_at: str = ""
    agent_name: str = ""
    agent_config: dict | None = None      # 当前 config
    original_config: dict | None = None   # 原始 config
    config_history: list[dict] | None = None
    memories: list[dict] | None = None
    friends: list[dict] | None = None

    def __init__(
        self,
        export_version="1.0",
        exported_at="",
        agent_name="",
        agent_config=None,
        original_config=None,
        config_history=None,
        memories=None,
        friends=None,
    ):
        self.export_version = export_version
        self.exported_at = exported_at
        self.agent_name = agent_name
        self.agent_config = agent_config or {}
        self.original_config = original_config or {}
        self.config_history = config_history or []
        self.memories = memories or []
        self.friends = friends or []

    def to_dict(self) -> dict:
        return {
            "export_version": self.export_version,
            "exported_at": self.exported_at,
            "agent_name": self.agent_name,
            "agent_config": self.agent_config,
            "original_config": self.original_config,
            "config_history": self.config_history,
            "memories": self.memories,
            "friends": self.friends,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "AgentSoulArchive":
        return cls(
            export_version=data.get("export_version", "1.0"),
            exported_at=data.get("exported_at", ""),
            agent_name=data.get("agent_name", ""),
            agent_config=data.get("agent_config", {}),
            original_config=data.get("original_config", {}),
            config_history=data.get("config_history", []),
            memories=data.get("memories", []),
            friends=data.get("friends", []),
        )

    @classmethod
    def validate(cls, data: dict) -> list[str]:
        """校验导入数据的结构，返回错误列表（空列表 = 合法）"""
        errors = []
        if "agent_config" not in data:
            errors.append("缺少 agent_config 字段")
        else:
            cfg = data["agent_config"]
            if not isinstance(cfg, dict):
                errors.append("agent_config 必须是对象")
        if "memories" in data and not isinstance(data["memories"], list):
            errors.append("memories 必须是数组")
        if "friends" in data and not isinstance(data["friends"], list):
            errors.append("friends 必须是数组")
        return errors
