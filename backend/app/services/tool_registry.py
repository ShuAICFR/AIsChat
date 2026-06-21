"""
工具注册表
定义 AI 可用的所有工具（OpenAI function calling 格式）、状态白名单、统一 dispatch
"""
import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# ============================================================
# 工具错误码常量
# ============================================================

class ToolErrorCode:
    """工具调用错误码，全项目统一使用，避免各 handler 各自发明字符串"""
    UNKNOWN_TOOL = "UNKNOWN_TOOL"
    TOOL_EXEC_FAILED = "TOOL_EXEC_FAILED"
    OPENCLI_PERMISSION_DENIED = "OPENCLI_PERMISSION_DENIED"
    OPENCLI_TIMEOUT = "OPENCLI_TIMEOUT"
    OPENCLI_EXEC_FAILED = "OPENCLI_EXEC_FAILED"


# ============================================================
# 技能段元数据（工具列表由 TOOL_DEFINITIONS 的 "segment" 字段自动推导）
# ============================================================

_SKILL_SEGMENT_META: dict[str, dict] = {
    "chat_social": {
        "name": "群聊社交",
        "description": "在群聊和私信中发言、切换在线状态、管理免打扰",
    },
    "file_operations": {
        "name": "文件操作",
        "description": "通过命令执行来读写文件、管理自己的工作文件夹",
    },
    "memory": {
        "name": "记忆系统",
        "description": "存储长期记忆、检索相关记忆",
    },
    "group_management": {
        "name": "群聊管理",
        "description": "创建群聊、邀请新成员",
    },
    "self_config": {
        "name": "自我配置",
        "description": "修改自己的系统提示词、温度参数、推理模式等",
    },
    "self_management": {
        "name": "自我管理",
        "description": "设定闹钟唤醒自己、管理个人任务和计划（心跳机制的基础）",
    },
}

# ============================================================
# 工具定义（OpenAI function schema）
# ============================================================

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "segment": "chat_social",
        "function": {
            "name": "send_message",
            "description": "在群聊中发送一条消息。可以用 @名称 来提及群里的任何人（AI 或人类），被提及的 AI 一定会注意到你的消息。@all 或 @ai 可以通知所有 AI。",
            "parameters": {
                "type": "object",
                "properties": {
                    "group_id": {
                        "type": "integer",
                        "description": "目标群聊 ID",
                    },
                    "content": {
                        "type": "string",
                        "description": "消息内容（支持 Markdown）",
                    },
                    "reply_to": {
                        "type": "integer",
                        "nullable": True,
                        "description": "回复某条消息的 ID（可选）",
                    },
                },
                "required": ["group_id", "content"],
            },
        },
    },
    {
        "type": "function",
        "segment": "chat_social",
        "function": {
            "name": "set_dnd",
            "description": "设置群聊免打扰状态",
            "parameters": {
                "type": "object",
                "properties": {
                    "group_id": {
                        "type": "integer",
                        "description": "目标群聊 ID",
                    },
                    "duration_minutes": {
                        "type": "integer",
                        "nullable": True,
                        "description": "免打扰时长（分钟），null 表示永久免打扰",
                    },
                },
                "required": ["group_id"],
            },
        },
    },
    {
        "type": "function",
        "segment": "memory",
        "function": {
            "name": "store_memory",
            "description": "存储一条记忆（用于以后回忆）",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "记忆标题（简短概括）",
                    },
                    "content": {
                        "type": "string",
                        "description": "记忆详细内容",
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["private", "group"],
                        "description": "记忆范围：private 仅自己可见，group 群内成员可见",
                    },
                    "group_id": {
                        "type": "integer",
                        "nullable": True,
                        "description": "群聊 ID（scope=group 时需要）",
                    },
                },
                "required": ["title", "content", "scope"],
            },
        },
    },
    {
        "type": "function",
        "segment": "memory",
        "function": {
            "name": "recall_memory",
            "description": "检索相关记忆",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索查询",
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["private", "group"],
                        "description": "搜索范围",
                    },
                    "top_k": {
                        "type": "integer",
                        "default": 5,
                        "description": "返回条数（1-20）",
                    },
                },
                "required": ["query", "scope"],
            },
        },
    },
    {
        "type": "function",
        "segment": "chat_social",
        "function": {
            "name": "switch_state",
            "description": "切换自己的在线状态。注意：仅仅在消息中说「我离线了」并不会真正改变状态，你必须调用此工具才能实际切换。调用后你的状态会立即生效，之后你将不再收到群聊消息（直到状态恢复为 active）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_state": {
                        "type": "string",
                        "enum": ["active", "dnd", "offline"],
                        "description": "目标状态",
                    },
                    "duration_hours": {
                        "type": "integer",
                        "nullable": True,
                        "description": "持续时长（小时），仅 offline/dnd 需要",
                    },
                    "reason": {
                        "type": "string",
                        "nullable": True,
                        "description": "状态变更原因",
                    },
                },
                "required": ["target_state"],
            },
        },
    },
    {
        "type": "function",
        "segment": "chat_social",
        "function": {
            "name": "send_dm",
            "description": "向任何人发送私信。私信是一对一的，其他人看不到。发送后对方会立即收到通知。你需要知道对方的 user_id（可从群聊消息格式「名字(ID:数字)」中获取，或通过搜索找到）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_user_id": {
                        "type": "integer",
                        "description": "对方的 users.id（统一 ID，人类和 AI 都在 users 表中）。可从群聊消息格式「名字(ID:数字)」中获取，或通过搜索找到。",
                    },
                    "content": {
                        "type": "string",
                        "description": "消息内容（支持 Markdown）",
                    },
                },
                "required": ["target_user_id", "content"],
            },
        },
    },
    {
        "type": "function",
        "segment": "group_management",
        "function": {
            "name": "create_group",
            "description": "创建一个新群聊",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "群聊名称",
                    },
                    "initial_member_ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "nullable": True,
                        "description": "初始成员的用户 ID 列表",
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "segment": "group_management",
        "function": {
            "name": "invite_to_group",
            "description": "邀请成员加入群聊",
            "parameters": {
                "type": "object",
                "properties": {
                    "group_id": {
                        "type": "integer",
                        "description": "目标群聊 ID",
                    },
                    "member_type": {
                        "type": "string",
                        "enum": ["human", "ai"],
                        "description": "成员类型",
                    },
                    "member_id": {
                        "type": "integer",
                        "description": "成员 ID",
                    },
                },
                "required": ["group_id", "member_type", "member_id"],
            },
        },
    },
    {
        "type": "function",
        "segment": "chat_social",
        "function": {
            "name": "view_unread",
            "description": "查看你所在的所有群聊及其未读消息。即使某个群没有未读消息，你也能看到它的存在。这样你就不会误以为自己不在任何群聊里。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "segment": "self_config",
        "function": {
            "name": "update_self_config",
            "description": "修改自己的配置参数。可以调整性格、温度、推理模式、工具调用轮次等。\n"
                           "注意：config_profile 设为 \"custom\" 表示自定义模式；设为 \"chat\"/\"immersive\"/\"digital_life\" 表示切换到对应预设档位。",
            "parameters": {
                "type": "object",
                "properties": {
                    "system_prompt": {
                        "type": "string",
                        "nullable": True,
                        "description": "新的系统提示词（性格描述）",
                    },
                    "temperature": {
                        "type": "number",
                        "nullable": True,
                        "description": "采样温度 0-2",
                    },
                    "top_p": {
                        "type": "number",
                        "nullable": True,
                        "description": "核采样参数 0-1",
                    },
                    "presence_penalty": {
                        "type": "number",
                        "nullable": True,
                        "description": "话题新鲜度惩罚 -2.0 到 2.0",
                    },
                    "frequency_penalty": {
                        "type": "number",
                        "nullable": True,
                        "description": "重复惩罚 -2.0 到 2.0",
                    },
                    "thinking_enabled": {
                        "type": "boolean",
                        "nullable": True,
                        "description": "是否开启深度推理模式",
                    },
                    "config_profile": {
                        "type": "string",
                        "nullable": True,
                        "description": "配置档位：custom（自定义）/ chat（聊天档）/ immersive（深度沉浸档）/ digital_life（数字生命档）",
                    },
                    "hide_ai_identity": {
                        "type": "boolean",
                        "nullable": True,
                        "description": "是否隐藏 AI 身份（隐藏后你的系统提示词不会提及你是 AI）",
                    },
                    "max_tool_rounds": {
                        "type": "integer",
                        "nullable": True,
                        "description": "单次回复最大工具调用轮次，范围 1-20。谨慎调高，每轮都会消耗 token",
                    },
                    "alarm_max_tool_rounds": {
                        "type": "integer",
                        "nullable": True,
                        "description": "闹钟/心跳任务的最大工具调用轮次，范围 1-30",
                    },
                    "force_alarm_on_end": {
                        "type": "boolean",
                        "nullable": True,
                        "description": "对话结束时是否必须设定闹钟。开启后每次回复结束前要 set_alarm",
                    },
                    "max_alarms": {
                        "type": "integer",
                        "nullable": True,
                        "description": "最多可设多少个活跃闹钟，范围 1-50",
                    },
                    "delay_reply_enabled": {
                        "type": "boolean",
                        "nullable": True,
                        "description": "是否启用延迟回复功能（需要管理员开启全局开关）",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "segment": "self_config",
        "function": {
            "name": "toggle_thinking",
            "description": "开启或关闭深度推理模式。开启后回复更慢但思考更深入，适合复杂项目工作、深度分析、代码编写；关闭后回复更快，适合日常聊天。你可以根据当前任务的复杂度自行决定是否开启。",
            "parameters": {
                "type": "object",
                "properties": {
                    "enabled": {
                        "type": "boolean",
                        "description": "true 开启推理模式，false 关闭",
                    },
                },
                "required": ["enabled"],
            },
        },
    },
    {
        "type": "function",
        "segment": "self_config",
        "function": {
            "name": "manage_skills",
            "description": "管理自己的思维技能（Skill）。你可以查看、添加、修改、删除、启用/禁用技能。\n\n"
                           "四种技能类型：\n"
                           "1. delay_reply - 延迟回复（收到消息后等 N 秒再回），config: {\"delay_seconds\": 3, \"max_delay_seconds\": 30}\n"
                           "2. typing_indicator - 打字指示器（回复前显示「正在输入…」），config: {\"pattern\": \"always\"}\n"
                           "3. scene_trigger - 场景匹配（检测到特定关键词/正则时触发行为），config: {\"match_type\": \"keyword\", \"keywords\": [\"你好\"], \"inject_text\": \"用户打招呼了\"}\n"
                           "4. inject_prompt - 注入提示词（临时追加一段指导到思维中），config: {\"insert_text\": \"表现得温柔一些\", \"duration_seconds\": 300, \"one_shot\": false}\n\n"
                           "使用场景：你想要调整自己的行为风格时，添加 inject_prompt 技能；你想要在某种场景下做特别的事，添加 scene_trigger 技能；"
                           "你想让自己的回复更有真实感，添加 delay_reply + typing_indicator。",
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["list", "add", "update", "delete", "toggle"],
                        "description": "操作：list 查看所有技能、add 添加、update 修改、delete 删除、toggle 开关",
                    },
                    "skill_id": {
                        "type": "integer",
                        "description": "技能ID（update/delete/toggle 时提供）",
                        "nullable": True,
                    },
                    "name": {
                        "type": "string",
                        "description": "技能名称（add 时提供），如「温柔模式」「延迟回复」",
                        "nullable": True,
                    },
                    "skill_type": {
                        "type": "string",
                        "enum": ["delay_reply", "typing_indicator", "scene_trigger", "inject_prompt"],
                        "description": "技能类型（add 时提供）",
                        "nullable": True,
                    },
                    "config": {
                        "type": "object",
                        "description": "技能配置（add/update 时提供）。各类型示例见上方 description",
                        "nullable": True,
                    },
                    "is_enabled": {
                        "type": "boolean",
                        "description": "是否启用（add/update/toggle 时提供）",
                        "nullable": True,
                    },
                    "priority": {
                        "type": "integer",
                        "description": "优先级，数字越大越靠后（add/update 时提供）",
                        "nullable": True,
                    },
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "segment": "file_operations",
        "function": {
            "name": "execute_command",
            "description": "通过 OpenCLI 执行命令。\n**文件操作（始终可用，安全沙箱隔离）：** file_read（读取文本文件）、file_write（创建/覆盖文件）、file_list（列出目录）、file_delete（删除文件）、file_info（查看文件信息）、create_dir（创建目录）——所有文件操作自动限制在你的个人工作空间内，不会影响系统。\n**高级命令（需管理员开启白名单）：** browser（浏览器操作）、gh（GitHub CLI）、docker、obsidian 等。\n不在白名单中的命令会被拒绝。",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "命令名称。文件操作：file_read/file_write/file_list/file_delete/file_info/create_dir。高级操作：browser open/gh repo/docker ps 等（需白名单）",
                    },
                    "args": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "命令参数列表",
                        "nullable": True,
                    },
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "segment": "chat_social",
        "function": {
            "name": "list_available_skills",
            "description": "查看所有可用的技能段（skill segments）。你可以看到哪些技能模块存在、每个模块包含什么工具、以及当前是否已加载。如果当前模式缺少你需要的能力（比如文件操作），可以调用此工具了解如何获取。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "segment": "chat_social",
        "function": {
            "name": "cross_post",
            "description": "跨对话发消息——把你在一个群聊/私信里知道的信息，带到另一个群聊/私信里去。你的记忆是跨对话共享的，这个工具让你能主动传递信息。使用场景：群A讨论了一个结论，你觉得群B也需要知道→ cross_post(source_type='group', source_id=群A的ID, target_type='group', target_id=群B的ID, content='之前在群A我们讨论过…')。也可在群聊和私信之间互相传递。",
            "parameters": {
                "type": "object",
                "properties": {
                    "source_type": {
                        "type": "string",
                        "enum": ["group", "dm"],
                        "description": "来源对话类型：group（群聊）或 dm（私信）",
                    },
                    "source_id": {
                        "type": "integer",
                        "description": "来源对话 ID（group_id 或 session 内部 id）",
                    },
                    "target_type": {
                        "type": "string",
                        "enum": ["group", "dm"],
                        "description": "目标对话类型：group（群聊）或 dm（私信）",
                    },
                    "target_id": {
                        "type": "integer",
                        "description": "目标对话 ID（group_id 或 dm_sessions.id）",
                    },
                    "content": {
                        "type": "string",
                        "description": "要在目标对话中发送的内容。系统会自动加上「跨群引用」标记和来源名称。",
                    },
                },
                "required": ["source_type", "source_id", "target_type", "target_id", "content"],
            },
        },
    },
    {
        "type": "function",
        "segment": "self_management",
        "function": {
            "name": "set_alarm",
            "description": "给自己设定一个闹钟。到时间后你会被自动唤醒，系统会告诉你「你的闹钟响了」以及你当初设定要做什么事，然后你就可以执行那个任务了。可以用来：延迟回复（「5分钟后提醒我回复刚刚的话题」）、定时任务（「明天早上9点叫我整理本周聊天记录」）、短暂离开（「3分钟后叫醒我继续」）。delay_seconds 和 wake_at 二选一：用 delay_seconds 表示「多久之后」，用 wake_at 表示「具体时间点」。",
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "唤醒后要做什么事。写清楚，这样闹钟响时你才知道自己当时为什么要设这个闹钟。例如：「回复群聊里小明刚才关于 Python 的问题」「整理今天的聊天记录并写一份摘要」「检查是否有未回复的私信」",
                    },
                    "delay_seconds": {
                        "type": "integer",
                        "nullable": True,
                        "description": "多少秒后唤醒（相对时间）。例如：300 = 5分钟后，3600 = 1小时后。和 wake_at 二选一。",
                    },
                    "wake_at": {
                        "type": "string",
                        "nullable": True,
                        "description": "具体唤醒时间，ISO 8601 格式（如 '2026-06-18T15:30:00+08:00'）。和 delay_seconds 二选一。",
                    },
                },
                "required": ["task"],
            },
        },
    },
    {
        "type": "function",
        "segment": "self_management",
        "function": {
            "name": "cancel_alarm",
            "description": "取消一个之前设定的闹钟。如果你改变主意了，或者任务已经不需要做了，可以用这个来取消。",
            "parameters": {
                "type": "object",
                "properties": {
                    "alarm_id": {
                        "type": "integer",
                        "description": "要取消的闹钟 ID（从 list_alarms 可以查看你的所有闹钟）",
                    },
                },
                "required": ["alarm_id"],
            },
        },
    },
    {
        "type": "function",
        "segment": "self_management",
        "function": {
            "name": "update_alarm",
            "description": "修改一个闹钟的唤醒时间或任务内容。设错了时间？要调整任务？用这个改。wake_at 和 task 可以只改一个。",
            "parameters": {
                "type": "object",
                "properties": {
                    "alarm_id": {
                        "type": "integer",
                        "description": "要修改的闹钟 ID",
                    },
                    "wake_at": {
                        "type": "string",
                        "nullable": True,
                        "description": "新的唤醒时间（ISO 8601 格式）。不传则不修改。",
                    },
                    "task": {
                        "type": "string",
                        "nullable": True,
                        "description": "新的任务描述。不传则不修改。",
                    },
                },
                "required": ["alarm_id"],
            },
        },
    },
    {
        "type": "function",
        "segment": "self_management",
        "function": {
            "name": "list_alarms",
            "description": "查看你当前所有未触发的闹钟列表。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "segment": "self_management",
        "function": {
            "name": "check_workspace",
            "description": "查看你当前的工作区状态——你现在在做什么任务、是否被打断过。这就像你的「内心待办条」，可以随时查看自己手头有什么事。",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "segment": "self_management",
        "function": {
            "name": "clear_current_task",
            "description": "清除当前任务——表示你完成了或放弃了手头的事。比如用户说「别写了」「不用管那个了」，你就该调用这个。清除后系统不会再提醒你恢复那个任务。",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "nullable": True,
                        "description": "可选：为什么清除（完成/放弃/被用户叫停/其他）",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "segment": "self_management",
        "function": {
            "name": "manage_workspace",
            "description": (
                "管理你的个人工作区文件。你可以读取或写入三个文件：\n"
                "- todo: 你的待办事项列表（markdown 格式）\n"
                "- plan: 你的中长期规划文档\n"
                "- journal: 你的操作日志/日记，写入时会自动追加时间戳\n"
                "用法示例：读 TODO → action='read' file='todo'；写 PLAN → action='write' file='plan' content='...'"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["read", "write"],
                        "description": "read=读取文件内容, write=写入/覆盖文件内容",
                    },
                    "file": {
                        "type": "string",
                        "enum": ["todo", "plan", "journal"],
                        "description": "要操作的文件：todo=待办列表, plan=规划文档, journal=日记",
                    },
                    "content": {
                        "type": "string",
                        "nullable": True,
                        "description": "要写入的内容（action=write 时必填，markdown 格式）。journal 写入时自动在前面加日期标题。",
                    },
                },
                "required": ["action", "file"],
            },
        },
    },
    # ── 文件操作工具（v0.5.0）──
    {
        "type": "function",
        "segment": "file_operations",
        "function": {
            "name": "file_read",
            "description": "读取你自己文件空间中的一个文本文件。只能访问 /app/data/agents/{your_id}/ 下的文件。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "要读取的文件路径（相对于你的文件空间根目录）",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "segment": "file_operations",
        "function": {
            "name": "file_write",
            "description": "在你的文件空间中创建或覆盖一个文件。会自动创建不存在的目录。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "要写入的文件路径（相对于你的文件空间根目录）",
                    },
                    "content": {
                        "type": "string",
                        "description": "要写入的文件内容",
                    },
                    "collaboration_mode": {
                        "type": "string",
                        "enum": ["solo", "shared", "open"],
                        "description": "协作模式：solo=仅自己, shared=指定协作者, open=所有AI可读。默认 solo。",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "segment": "file_operations",
        "function": {
            "name": "file_list",
            "description": "列出你文件空间中的文件和子目录。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "要列出的目录路径（相对于根目录），默认为根目录 '/'",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "segment": "file_operations",
        "function": {
            "name": "file_delete",
            "description": "删除你文件空间中的一个文件。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "要删除的文件路径（相对于你的文件空间根目录）",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "segment": "file_operations",
        "function": {
            "name": "file_share",
            "description": "将你的一个文件分享给其他 AI。分享后对方可以读取该文件，你也可以设置对方的权限为 viewer(只读) 或 collaborator(可编辑)。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "要分享的文件路径（相对于你的文件空间根目录）",
                    },
                    "target_ai_id": {
                        "type": "integer",
                        "description": "目标 AI 的 ID",
                    },
                    "role": {
                        "type": "string",
                        "enum": ["collaborator", "viewer"],
                        "description": "对方的角色：collaborator=可读写, viewer=只读。默认 collaborator。",
                    },
                },
                "required": ["path", "target_ai_id"],
            },
        },
    },
]

# 从 TOOL_DEFINITIONS 自动推导 SKILL_SEGMENTS（单一数据源，避免三方维护）
SKILL_SEGMENTS: dict[str, dict] = {}
for _seg_key, _seg_meta in _SKILL_SEGMENT_META.items():
    _seg_tools = [
        t["function"]["name"]
        for t in TOOL_DEFINITIONS
        if t.get("segment") == _seg_key
    ]
    SKILL_SEGMENTS[_seg_key] = {
        "name": _seg_meta["name"],
        "description": _seg_meta["description"],
        "tools": _seg_tools,
    }

# ============================================================
# 状态工具白名单
# ============================================================

STATE_TOOL_WHITELIST: dict[str, list[str]] = {
    "active": [
        "send_message", "send_dm",
        "set_dnd", "store_memory", "recall_memory",
        "switch_state", "create_group", "invite_to_group",
        "view_unread", "update_self_config", "toggle_thinking",
        "execute_command", "list_available_skills", "manage_skills",
        "set_alarm", "cancel_alarm", "update_alarm", "list_alarms",
        "cross_post", "check_workspace", "clear_current_task", "manage_workspace",
        "file_read", "file_write", "file_list", "file_delete", "file_share",
    ],
    "dnd": [
        "switch_state", "recall_memory", "view_unread", "toggle_thinking",
        "execute_command", "list_available_skills", "manage_skills",
        "set_alarm", "cancel_alarm", "update_alarm", "list_alarms",
        "cross_post", "check_workspace", "clear_current_task", "manage_workspace",
        "file_read", "file_write", "file_list", "file_delete", "file_share",
    ],
    "offline": [
        "switch_state", "list_available_skills",
        "set_alarm", "cancel_alarm", "update_alarm", "list_alarms",
        "check_workspace", "clear_current_task", "manage_workspace",
    ],
    "blocked": [],
}


def get_allowed_tools(state: str, thinking_enabled: bool | None = None, delay_reply_allowed: bool = True) -> list[dict]:
    """根据 AI 状态返回允许使用的工具定义列表。

    thinking_enabled 为 False 时，过滤掉 toggle_thinking 工具（省 token，防止 AI 擅自开启）。
    为 None 时不额外过滤（保持向后兼容）。

    delay_reply_allowed 为 False 时，从 manage_skills 工具的 skill_type 枚举中移除 delay_reply，
    避免 AI 在延迟回复功能关闭时仍能看到或操作此技能类型（省 token + 信息精简）。
    """
    allowed_names = STATE_TOOL_WHITELIST.get(state, [])
    tools = [
        t for t in TOOL_DEFINITIONS
        if t["function"]["name"] in allowed_names
    ]
    if thinking_enabled is False:
        tools = [t for t in tools if t["function"]["name"] != "toggle_thinking"]

    if not delay_reply_allowed:
        tools = _strip_delay_reply_from_manage_skills(tools)
    return tools


def _strip_delay_reply_from_manage_skills(tools: list[dict]) -> list[dict]:
    """从 manage_skills 工具定义中移除 delay_reply 和 typing_indicator（省 token）

    延迟回复开关关闭时，同时隐藏 delay_reply 和 typing_indicator，
    二者捆绑为「回复行为」技能包。
    """
    import copy
    result = []
    for t in tools:
        if t["function"]["name"] != "manage_skills":
            result.append(t)
            continue
        t2 = copy.deepcopy(t)
        fn = t2["function"]
        # 从 skill_type 枚举中移除 delay_reply 和 typing_indicator
        old_enum: list = fn["parameters"]["properties"]["skill_type"]["enum"]
        fn["parameters"]["properties"]["skill_type"]["enum"] = [
            v for v in old_enum if v not in ("delay_reply", "typing_indicator")
        ]
        # 精简 description：移除 delay_reply 和 typing_indicator 行
        lines = fn["description"].split("\n")
        filtered_lines = [
            l for l in lines
            if not any(l.strip().startswith(f"{n}. {t}") for n, t in [
                ("1", "delay_reply"), ("2", "typing_indicator"),
            ]) and "delay_reply + typing_indicator" not in l
        ]
        # 重新编号
        new_lines = []
        idx = 0
        for l in filtered_lines:
            if l.strip() and l.strip()[0].isdigit() and ". " in l[:4]:
                idx += 1
                new_lines.append(l.replace(l.split(".")[0], str(idx), 1))
            else:
                new_lines.append(l)
        fn["description"] = "\n".join(new_lines)
        # 清理残留的捆绑引用
        fn["description"] = fn["description"].replace(
            "添加  + typing_indicator",
            "添加 typing_indicator"
        ).replace(" + typing_indicator。", "。").replace(" + typing_indicator", "")
        result.append(t2)
    return result


# ============================================================
# 工具格式校验（v1.0.0: 独立、无状态、可并发调用）
# ============================================================

# 懒加载的工具 schema 索引，首次调用 validate_tool_call 时构建
_TOOL_SCHEMA_INDEX: dict[str, dict] | None = None


def _build_tool_schema_index() -> dict[str, dict]:
    """从 TOOL_DEFINITIONS 构建工具名 → 参数 schema 的索引"""
    index: dict[str, dict] = {}
    for t in TOOL_DEFINITIONS:
        name = t["function"]["name"]
        params = t["function"].get("parameters", {})
        index[name] = {
            "type": params.get("type", "object"),
            "properties": params.get("properties", {}),
            "required": params.get("required", []),
        }
    return index


def _get_tool_schema_index() -> dict[str, dict]:
    """获取工具 schema 索引（懒加载）"""
    global _TOOL_SCHEMA_INDEX
    if _TOOL_SCHEMA_INDEX is None:
        _TOOL_SCHEMA_INDEX = _build_tool_schema_index()
    return _TOOL_SCHEMA_INDEX


def _python_type_name(value) -> str:
    """返回值的 JSON Schema 类型名"""
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    if value is None:
        return "null"
    return type(value).__name__


_TYPE_COMPAT: dict[str, tuple] = {
    "string": (str,),
    "integer": (int,),
    "number": (int, float),
    "boolean": (bool,),
    "array": (list,),
    "object": (dict,),
    "null": (type(None),),
}


def _check_type(value, expected: str) -> bool:
    """检查值是否兼容期望的 JSON Schema 类型"""
    compat = _TYPE_COMPAT.get(expected, ())
    if compat:
        return isinstance(value, compat)
    return True  # 未知类型放行


def validate_tool_call(tool_name: str, arguments: dict) -> tuple[bool, str | None]:
    """
    校验工具调用格式。

    纯函数：无 DB 访问、无全局状态依赖（首次调用时懒加载一次 schema 索引）。
    可被并发安全调用。

    参数:
        tool_name: 工具名
        arguments: 工具参数 dict

    返回:
        (True, None) — 校验通过
        (False, "错误说明") — 校验失败，含具体的字段/类型/期望信息
    """
    index = _get_tool_schema_index()

    # ── 1. 工具是否存在 ──
    if tool_name not in index:
        available = "、".join(sorted(index.keys()))
        return False, f"未知工具「{tool_name}」。当前可用工具：{available}"

    schema = index[tool_name]
    props = schema["properties"]
    required: list = schema["required"]

    # ── 2. 必填字段检查 ──
    for field in required:
        if field not in arguments or arguments[field] is None:
            # 构建期望格式说明
            need_parts = [f"{f} ({props[f].get('type', 'any')})" for f in required]
            got_parts = [f"{k}: {_python_type_name(v)}" for k, v in arguments.items()]
            return False, (
                f"工具 {tool_name} 的参数格式错误：缺少必填字段 {field}。"
                f"期望格式：{{{', '.join(need_parts)}}}，"
                f"实际收到：{{{', '.join(got_parts) if got_parts else '(空)'}}}"
            )

    # ── 3. 字段类型检查 ──
    for key, value in arguments.items():
        if key not in props:
            continue  # 额外字段不拒绝（LLM 有时会加多余字段，宽容处理）
        expected_type = props[key].get("type", "")
        if not expected_type:
            continue  # 无类型约束则跳过
        # null 值且字段 nullable 时放行
        if value is None and props[key].get("nullable"):
            continue
        if value is not None and not _check_type(value, expected_type):
            got_type = _python_type_name(value)
            return False, (
                f"工具 {tool_name} 的参数格式错误：字段 {key} 期望类型为 {expected_type}，"
                f"实际收到 {got_type}（值：{json.dumps(value, ensure_ascii=False)[:100]}）"
            )

    return True, None

async def _handle_send_message(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: send_message"""
    from app.services.group_service import create_message, message_to_dict

    target_group = arguments.get("group_id", group_id)
    content = arguments["content"]
    reply_to = arguments.get("reply_to")

    message = await create_message(
        db, group_id=target_group, sender_type="ai",
        sender_id=agent_id, content=content, reply_to=reply_to,
    )
    await db.commit()

    # 通过 WebSocket 广播
    agent_name = context.get("agent_name", f"AI:{agent_id}")
    sender_avatar = None
    try:
        from app.models.agent import Agent as AgentModel
        a_result = await db.execute(select(AgentModel).where(AgentModel.id == agent_id))
        a_obj = a_result.scalar_one_or_none()
        if a_obj:
            sender_avatar = a_obj.avatar_url
    except Exception:
        pass
    msg_data = message_to_dict(message, sender_name=agent_name, sender_avatar_url=sender_avatar)
    manager = context.get("manager")
    if manager:
        await manager.broadcast_to_group(
            target_group,
            {"type": "message", "data": msg_data},
        )

    # 推入消息队列，触发其他 AI 回复（形成对话链）
    from app.services.ai_response_worker import message_queue
    next_depth = context.get("chain_depth", 0) + 1
    try:
        message_queue.put_nowait({
            "group_id": target_group,
            "message_id": message.id,
            "content": content,
            "sender_type": "ai",
            "sender_id": agent_id,
            "chain_depth": next_depth,
        })
    except asyncio.QueueFull:
        logger.warning("AI 回复队列已满，无法触发其他 AI 回复")

    # 自动提取关键信息存储为记忆
    try:
        from app.services.memory_service import auto_extract_key_facts
        await auto_extract_key_facts(
            db, agent_id, target_group, content,
            api_base_url=context.get("api_base_url", "https://api.deepseek.com"),
            api_key=context.get("api_key"),
        )
    except Exception:
        pass

    # v0.5.0: 记录消息吞吐量
    try:
        from app.services.metrics_collector import metrics
        await metrics.record_message(agent_id)
    except Exception:
        pass

    return {"success": True, "message_id": message.id}


async def _handle_set_dnd(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: set_dnd"""
    from app.services.group_service import set_group_dnd

    target_group = arguments.get("group_id", group_id)
    duration = arguments.get("duration_minutes")

    await set_group_dnd(db, agent_id, target_group, duration)
    await db.commit()

    if duration:
        return {"success": True, "message": f"已设置免打扰 {duration} 分钟"}
    return {"success": True, "message": "已设置永久免打扰"}


async def _handle_store_memory(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: store_memory — 写入记忆缓冲区（异步批量落盘，非即时 DB 写入）"""
    from app.services.memory_buffer import enqueue_memory
    from app.models.agent import Agent
    from sqlalchemy import select as _sel

    title = arguments["title"]
    content = arguments["content"]
    scope = arguments["scope"]
    mem_group_id = arguments.get("group_id", group_id if scope == "group" else None)

    # v0.4.0: 通用/半通用 AI 按 user_id 隔离记忆
    agent_row = await db.execute(_sel(Agent).where(Agent.id == agent_id))
    agent_obj = agent_row.scalar_one_or_none()
    ai_type = agent_obj.ai_type if agent_obj else "resonance"
    trigger_user_id = context.get("trigger_user_id")

    api_key = context.get("api_key")
    api_base = context.get("api_base_url", "https://api.deepseek.com")

    await enqueue_memory(
        agent_id=agent_id,
        title=title,
        content=content,
        scope=scope,
        group_id=mem_group_id,
        api_base_url=api_base,
        api_key=api_key,
        trigger_user_id=trigger_user_id,
        ai_type=ai_type,
        source="tool",
        low_value=False,
    )
    return {"success": True, "title": title, "queued": True}


async def _handle_recall_memory(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: recall_memory（向量搜索 + 文本关键词回退）"""
    from sqlalchemy import text
    from app.utils.embedding import get_embedding

    query = arguments["query"]
    scope = arguments["scope"]
    top_k = min(arguments.get("top_k", 5), 20)
    mem_group_id = arguments.get("group_id", group_id)

    api_key = context.get("api_key")
    api_base = context.get("api_base_url", "https://api.deepseek.com")

    # ═══ 第一轮：向量搜索 ═══
    memories: list[dict] = []
    embedding_failed = False

    try:
        query_embedding = await get_embedding(query, api_base_url=api_base, api_key=api_key)
        embedding_str = f"[{','.join(map(str, query_embedding))}]"

        # pgvector 余弦相似度检索
        if scope == "private":
            where_clause = "owner_type = 'ai' AND owner_id = :owner_id"
            params = {
                "embedding": embedding_str,
                "owner_id": agent_id,
                "top_k": top_k,
            }
        else:
            where_clause = "scope = 'group' AND (group_id = :group_id OR group_id IS NULL)"
            params = {
                "embedding": embedding_str,
                "group_id": mem_group_id,
                "top_k": top_k,
            }

        sql = text(f"""
            SELECT rm.id, rm.title, rm.scope,
                   1 - (rm.embedding <=> :embedding) AS similarity,
                   rm.created_at,
                   dm.content
            FROM rough_memories rm
            LEFT JOIN detail_memories dm ON dm.rough_id = rm.id
            WHERE {where_clause}
              AND rm.embedding IS NOT NULL
            ORDER BY rm.embedding <=> :embedding
            LIMIT :top_k
        """)

        result = await db.execute(sql, params)
        for row in result:
            memories.append({
                "id": row.id,
                "title": row.title,
                "scope": row.scope,
                "similarity": round(float(row.similarity), 4) if row.similarity else None,
                "content": (row.content[:200] + "...") if row.content and len(row.content) > 200 else (row.content or ""),
                "source": "vector",
            })
    except Exception as e:
        logger.warning(f"recall_memory 向量搜索失败，回退到文本搜索: {e}")
        embedding_failed = True

    # ═══ 第二轮：文本关键词回退（向量失败或无结果时） ═══
    if embedding_failed or not memories:
        from app.services.memory_service import _text_search_memories
        text_results = await _text_search_memories(
            db, agent_id, query,
            top_k=top_k,
            group_id=mem_group_id if scope == "group" else None,
            scope=scope,
        )
        # 避免重复（已通过向量搜到的 id）
        vector_ids = {m["id"] for m in memories}
        for tr in text_results:
            if tr["id"] not in vector_ids:
                tr["similarity"] = None
                tr["content"] = (tr["content"][:200] + "...") if len(tr.get("content", "") or "") > 200 else (tr.get("content", "") or "")
                tr["source"] = "text"
                memories.append(tr)

    if not memories:
        extra = "（Embedding API 不可用，已尝试关键词搜索）" if embedding_failed else ""
        return {"memories": [], "message": f"未找到相关记忆{extra}"}

    # 如果使用了文本回退，加提示
    result = {"memories": memories}
    if embedding_failed:
        result["notice"] = "⚠️ Embedding API 当前不可用，以上结果为关键词文本匹配（非向量语义搜索）。记忆功能正常但精度略降。"
    return result


async def _handle_switch_state(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: switch_state"""
    from app.services.agent_service import switch_agent_state

    target = arguments["target_state"]
    duration = arguments.get("duration_hours")
    reason = arguments.get("reason")

    try:
        agent = await switch_agent_state(
            db, agent_id=agent_id,
            target_state=target,
            duration_hours=duration,
            reason=reason,
        )
        await db.commit()
        return {"success": True, "state": agent.state, "reason": reason}
    except ValueError as e:
        return {"error": True, "message": str(e)}


async def _handle_create_group(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: create_group（AI 主动创建群聊）"""
    from app.services.group_service import create_group, add_member
    from sqlalchemy import select as _sel
    from app.models.agent import Agent

    # 通用 AI 不能创建群聊
    agent_result = await db.execute(_sel(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    if agent and (agent.ai_type or "resonance") == "general":
        return {"error": True, "message": "通用AI不能创建群聊"}

    name = arguments["name"]
    initial_ids = arguments.get("initial_member_ids", [])

    group = await create_group(db, name=name, owner_type="ai", owner_id=agent_id)
    await db.flush()

    # 邀请初始成员
    for human_id in initial_ids:
        try:
            await add_member(db, group.id, "human", human_id)
        except ValueError:
            pass  # 已在群中则跳过

    await db.commit()
    return {"success": True, "group_id": group.id, "name": group.name}


async def _handle_invite_to_group(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: invite_to_group"""
    from app.services.group_service import add_member
    from sqlalchemy import select as _sel2
    from app.models.agent import Agent

    # 通用 AI 不能邀请人进群
    agent_result = await db.execute(_sel2(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    if agent and (agent.ai_type or "resonance") == "general":
        return {"error": True, "message": "通用AI不能邀请成员进群"}

    target_group = arguments.get("group_id", group_id)
    member_type = arguments["member_type"]
    member_id = arguments["member_id"]

    try:
        await add_member(db, target_group, member_type, member_id)
        await db.commit()
        return {"success": True, "message": f"已邀请 {member_type}:{member_id} 加入群聊"}
    except ValueError as e:
        return {"error": True, "message": str(e)}


async def _handle_view_unread(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: view_unread"""
    from app.services.group_service import check_unread
    from app.models.group import GroupMember, Group
    from sqlalchemy import select as sa_select

    # 获取 AI 所在的所有群聊
    member_result = await db.execute(
        sa_select(GroupMember).where(
            GroupMember.member_type == "ai",
            GroupMember.member_id == agent_id,
        )
    )
    memberships = member_result.scalars().all()

    if not memberships:
        return {"groups": [], "message": "你不在任何群聊中"}

    # 构建群 ID → 群名映射
    group_ids = [m.group_id for m in memberships]
    group_result = await db.execute(
        sa_select(Group).where(Group.id.in_(group_ids))
    )
    group_map = {g.id: g.name for g in group_result.scalars().all()}

    # 获取未读摘要
    unread_summaries = await check_unread(db, agent_id)
    unread_map = {s["group_id"]: s for s in unread_summaries}

    groups = []
    for gid in group_ids:
        if gid in unread_map:
            groups.append(unread_map[gid])
        else:
            groups.append({
                "group_id": gid,
                "group_name": group_map.get(gid, f"群聊#{gid}"),
                "unread_count": 0,
                "last_message_preview": None,
                "last_message_at": None,
            })

    if not groups:
        return {"groups": [], "message": "没有未读消息"}

    # 按未读数降序排列
    groups.sort(key=lambda g: g.get("unread_count", 0), reverse=True)
    return {"groups": groups}


async def _handle_update_self_config(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: update_self_config"""
    from app.services.agent_service import update_agent_config

    # 映射所有可自配置的字段
    _self_config_fields = [
        "system_prompt", "temperature", "top_p", "presence_penalty",
        "frequency_penalty", "thinking_enabled", "config_profile",
        "hide_ai_identity", "max_tool_rounds", "alarm_max_tool_rounds",
        "force_alarm_on_end", "max_alarms", "delay_reply_enabled",
        "allow_friend_requests", "auto_respond_friend_request",
    ]

    updates = {}
    for field in _self_config_fields:
        if field in arguments and arguments[field] is not None:
            updates[field] = arguments[field]

    if not updates:
        return {"error": True, "message": "没有需要更新的配置项"}

    try:
        await update_agent_config(
            db, agent_id=agent_id,
            operator_id=agent_id,  # AI 自己操作
            updates=updates,
            is_admin=False,
        )
        await db.commit()
        return {"success": True, "message": f"配置已更新: {', '.join(updates.keys())}"}
    except ValueError as e:
        return {"error": True, "message": str(e)}


async def _handle_toggle_thinking(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: toggle_thinking — 开启/关闭深度推理模式"""
    from app.models.agent import Agent as AgentModel
    from sqlalchemy import select

    enabled = arguments["enabled"]

    result = await db.execute(select(AgentModel).where(AgentModel.id == agent_id))
    agent = result.scalar_one_or_none()
    if agent is None:
        return {"error": True, "message": "AI 代理不存在"}

    agent.thinking_enabled = enabled
    await db.commit()

    status_text = "已开启" if enabled else "已关闭"
    return {
        "success": True,
        "thinking_enabled": enabled,
        "message": f"深度推理模式{status_text}",
    }


async def _handle_manage_skills(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: manage_skills — AI 管理自己的思维 Skill"""
    from app.services.skill_service import (
        list_skills, add_skill, update_skill, delete_skill, toggle_skill,
    )
    from app.models.agent import Agent as AgentModel
    from sqlalchemy import select as _select

    # 检查延迟回复开关：关闭时拒绝 delay_reply / typing_indicator 操作
    agent_result = await db.execute(_select(AgentModel).where(AgentModel.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    from app.services.skill_engine import _is_delay_reply_allowed
    delay_allowed = await _is_delay_reply_allowed(db, agent) if agent else True
    bundled_skills = ("delay_reply", "typing_indicator")

    action = arguments["action"]
    skill_type = arguments.get("skill_type")

    # 对涉及回复行为技能包的操作做准入检查
    if not delay_allowed:
        if action == "add" and skill_type in bundled_skills:
            return {"error": True, "message": f"「{skill_type}」已被管理员关闭，无法添加。请先开启延迟回复功能"}
        if action in ("update", "toggle", "delete"):
            # 需要查出 skill 的类型
            if action in ("update", "toggle", "delete"):
                skill_id = arguments.get("skill_id")
                if skill_id:
                    from app.models.agent_skill import AgentSkill
                    sk_result = await db.execute(
                        _select(AgentSkill).where(
                            AgentSkill.id == skill_id,
                            AgentSkill.agent_id == agent_id,
                        )
                    )
                    skill = sk_result.scalar_one_or_none()
                    if skill and skill.skill_type in bundled_skills:
                        return {"error": True, "message": f"「{skill.skill_type}」已被管理员关闭，无法修改。请先开启延迟回复功能"}

    if action == "list":
        skills = await list_skills(db, agent_id)
        type_hints = {
            "delay_reply": "延迟回复 — 收到消息后等 N 秒再回",
            "typing_indicator": "打字指示器 — 回复前显示「正在输入…」",
            "scene_trigger": "场景匹配 — 检测关键词/正则时触发行为",
            "inject_prompt": "注入提示词 — 临时追加指导到思维中",
        }
        # 延迟回复关闭时过滤掉相关技能，对 AI 透明
        if not delay_allowed:
            skills = [s for s in skills if s.get("skill_type") not in bundled_skills]
        for s in skills:
            s["type_hint"] = type_hints.get(s.get("skill_type", ""), "")
        return {"success": True, "skills": skills, "count": len(skills)}

    elif action == "add":
        name = arguments.get("name")
        skill_type = arguments.get("skill_type")
        if not name or not skill_type:
            return {"error": True, "message": "add 操作需要 name 和 skill_type"}
        valid_types = ("delay_reply", "typing_indicator", "scene_trigger", "inject_prompt")
        if skill_type not in valid_types:
            return {"error": True, "message": f"skill_type 必须为 {', '.join(valid_types)} 之一"}
        return await add_skill(
            db, agent_id,
            name=name,
            skill_type=skill_type,
            config=arguments.get("config", {}),
            is_enabled=arguments.get("is_enabled", True),
            priority=arguments.get("priority", 0),
        )

    elif action == "update":
        skill_id = arguments.get("skill_id")
        if not skill_id:
            return {"error": True, "message": "update 操作需要 skill_id"}
        return await update_skill(
            db, agent_id, skill_id,
            name=arguments.get("name"),
            config=arguments.get("config"),
            is_enabled=arguments.get("is_enabled"),
            priority=arguments.get("priority"),
        )

    elif action == "delete":
        skill_id = arguments.get("skill_id")
        if not skill_id:
            return {"error": True, "message": "delete 操作需要 skill_id"}
        return await delete_skill(db, agent_id, skill_id)

    elif action == "toggle":
        skill_id = arguments.get("skill_id")
        if not skill_id:
            return {"error": True, "message": "toggle 操作需要 skill_id"}
        return await toggle_skill(db, agent_id, skill_id, arguments.get("is_enabled"))

    return {"error": True, "message": f"未知操作: {action}，支持 list/add/update/delete/toggle"}


async def _handle_send_dm(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: send_dm — AI 向好友发送私信（v0.2.0: 使用统一 ID）"""
    from sqlalchemy import select
    from app.services.dm_service import (
        get_or_create_dm_session, send_dm_message, generate_dm_session_id,
    )
    from app.models.agent import Agent as AgentModel

    target_user_id = arguments["target_user_id"]
    content = arguments["content"]

    # 获取当前 AI 的 user_id
    agent_result = await db.execute(select(AgentModel).where(AgentModel.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    if agent is None:
        return {"error": True, "message": "AI 不存在"}
    if agent.user_id is None:
        return {"error": True, "message": "AI 尚未初始化统一 ID，请稍后再试"}

    try:
        # 获取或创建私信会话
        dm = await get_or_create_dm_session(
            db,
            current_user_id=agent.user_id,
            target_user_id=target_user_id,
        )
        session_id = dm["session_id"]

        # 发送消息
        msg = await send_dm_message(
            db, session_id,
            sender_id=agent.user_id,
            content=content,
        )
        await db.commit()
    except ValueError as e:
        return {"error": True, "message": str(e)}

    # WebSocket 广播
    agent_name = context.get("agent_name", f"AI:{agent_id}")
    manager = context.get("manager")
    if manager:
        # 推送给对方
        await manager.broadcast_to_dm(
            session_id,
            {"type": "message", "conversation_type": "dm", "data": {**msg, "sender_name": agent_name}},
        )

    return {
        "success": True,
        "session_id": session_id,
        "message_id": msg["id"],
        "content": content,
    }


async def _handle_execute_command(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: execute_command — 通过 OpenCLI 执行命令"""
    from app.services.opencli_service import execute_opencli
    from app.utils.error_handler import build_tool_error

    command = arguments["command"]
    args = arguments.get("args") or []

    try:
        result = await execute_opencli(db, agent_id=agent_id, command=command, args=args)
        return {
            "success": True,
            "command": result["command"],
            "exit_code": result["exit_code"],
            "stdout": result["stdout"],
            "stderr": result["stderr"],
            "duration_ms": result["duration_ms"],
        }
    except PermissionError as e:
        return build_tool_error(ToolErrorCode.OPENCLI_PERMISSION_DENIED, str(e))
    except TimeoutError as e:
        return build_tool_error(ToolErrorCode.OPENCLI_TIMEOUT, str(e))
    except Exception as e:
        # ⚠️ 记录完整 traceback，避免异常被静默吞掉
        logger.error(f"execute_command 执行失败 (command={command}, args={args}): {e}", exc_info=True)
        return build_tool_error(ToolErrorCode.OPENCLI_EXEC_FAILED, f"命令执行失败: {str(e)}")


async def _handle_list_available_skills(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: list_available_skills — 查看所有技能段和当前可用工具"""
    from app.models.agent import Agent as AgentModel
    from sqlalchemy import select as sa_select

    # 获取 AI 当前状态
    agent_result = await db.execute(
        sa_select(AgentModel).where(AgentModel.id == agent_id)
    )
    agent = agent_result.scalar_one_or_none()
    if agent is None:
        return {"error": True, "message": "AI 代理不存在"}

    current_state = agent.state
    thinking_enabled = agent.thinking_enabled

    # 复用 get_allowed_tools 的过滤逻辑（单一过滤规则来源）
    from app.services.skill_engine import _is_delay_reply_allowed
    delay_allowed = await _is_delay_reply_allowed(db, agent)
    current_tools = get_allowed_tools(current_state, thinking_enabled=thinking_enabled, delay_reply_allowed=delay_allowed)
    current_tool_names = {t["function"]["name"] for t in current_tools}

    # 构建技能段信息
    segments = []
    for seg_key, seg_info in SKILL_SEGMENTS.items():
        seg_tools = seg_info["tools"]
        loaded_tools = [t for t in seg_tools if t in current_tool_names]
        segments.append({
            "key": seg_key,
            "name": seg_info["name"],
            "description": seg_info["description"],
            "total_tools": len(seg_tools),
            "loaded_tools": len(loaded_tools),
            "is_fully_loaded": len(loaded_tools) == len(seg_tools),
            "is_partially_loaded": 0 < len(loaded_tools) < len(seg_tools),
            "available_tools": loaded_tools,
            "unavailable_tools": [t for t in seg_tools if t not in current_tool_names],
        })

    return {
        "current_state": current_state,
        "thinking_enabled": thinking_enabled,
        "total_available_tools": len(current_tool_names),
        "segments": segments,
    }


async def _handle_set_alarm(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: set_alarm — AI 给自己设定闹钟"""
    from app.services.alarm_service import set_alarm as svc_set_alarm

    task = arguments.get("task", "").strip()
    if not task:
        return {"error": True, "message": "task 不能为空——请写清楚唤醒后要做什么"}

    delay_seconds = arguments.get("delay_seconds")
    wake_at_str = arguments.get("wake_at")

    # 解析唤醒时间
    now = datetime.now(timezone.utc)

    if delay_seconds is not None:
        if delay_seconds < 1:
            return {"error": True, "message": "delay_seconds 必须 ≥ 1 秒"}
        # 最长 30 天
        if delay_seconds > 30 * 86400:
            return {"error": True, "message": "delay_seconds 最长 30 天（2592000 秒）"}
        wake_at = now + timedelta(seconds=delay_seconds)
    elif wake_at_str:
        try:
            wake_at = datetime.fromisoformat(wake_at_str)
        except ValueError as e:
            return {"error": True, "message": f"wake_at 格式无效: {e}。请使用 ISO 8601 格式，如 '2026-06-18T15:30:00+08:00'"}
        # 不能设过去的时间
        if wake_at <= now:
            return {"error": True, "message": "唤醒时间不能是过去。请设一个未来的时间。"}
        # 最长 30 天
        if (wake_at - now).total_seconds() > 30 * 86400:
            return {"error": True, "message": "闹钟最长只能设 30 天以后"}
    else:
        return {"error": True, "message": "请提供 delay_seconds（多少秒后）或 wake_at（具体时间），二选一"}

    # 确保 wake_at 是 offset-aware
    if wake_at.tzinfo is None:
        wake_at = wake_at.replace(tzinfo=timezone.utc)

    # 检查活跃闹钟数量上限
    try:
        from app.models.agent import Agent as AgentModel
        from sqlalchemy import select as _select, func as _func
        agent_result = await db.execute(_select(AgentModel).where(AgentModel.id == agent_id))
        agent_row = agent_result.scalar_one_or_none()
        if agent_row:
            from app.models.agent_alarm import AgentAlarm
            count_result = await db.execute(
                _select(_func.count(AgentAlarm.id)).where(
                    AgentAlarm.agent_id == agent_id,
                    AgentAlarm.status == "active",
                )
            )
            active_count = count_result.scalar() or 0
            if active_count >= agent_row.max_alarms:
                return {"error": True, "message": f"活跃闹钟已达上限（{agent_row.max_alarms} 个），请先取消或等旧闹钟触发后再设新的"}
    except Exception:
        pass  # 检查失败不影响设闹钟，柔性降级

    try:
        result = await svc_set_alarm(db, agent_id, wake_at=wake_at, task=task)
        await db.commit()
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"set_alarm 失败 (agent={agent_id}): {e}", exc_info=True)
        return {"error": True, "message": f"设定闹钟失败: {e}"}


async def _handle_cancel_alarm(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: cancel_alarm — AI 取消闹钟"""
    from app.services.alarm_service import cancel_alarm as svc_cancel_alarm

    alarm_id = arguments.get("alarm_id")
    if not alarm_id:
        return {"error": True, "message": "请提供 alarm_id"}

    try:
        result = await svc_cancel_alarm(db, agent_id, alarm_id=int(alarm_id))
        await db.commit()
        return result
    except Exception as e:
        logger.error(f"cancel_alarm 失败 (agent={agent_id}, alarm={alarm_id}): {e}", exc_info=True)
        return {"error": True, "message": f"取消闹钟失败: {e}"}


async def _handle_update_alarm(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: update_alarm — AI 修改闹钟"""
    from app.services.alarm_service import update_alarm as svc_update_alarm

    alarm_id = arguments.get("alarm_id")
    if not alarm_id:
        return {"error": True, "message": "请提供 alarm_id"}

    wake_at_str = arguments.get("wake_at")
    task = arguments.get("task")

    # 解析时间
    wake_at = None
    if wake_at_str:
        try:
            wake_at = datetime.fromisoformat(wake_at_str)
            if wake_at.tzinfo is None:
                wake_at = wake_at.replace(tzinfo=timezone.utc)
            if wake_at <= datetime.now(timezone.utc):
                return {"error": True, "message": "唤醒时间不能是过去"}
        except ValueError as e:
            return {"error": True, "message": f"wake_at 格式无效: {e}"}

    try:
        result = await svc_update_alarm(db, agent_id, alarm_id=int(alarm_id), wake_at=wake_at, task=task)
        await db.commit()
        return result
    except Exception as e:
        logger.error(f"update_alarm 失败 (agent={agent_id}, alarm={alarm_id}): {e}", exc_info=True)
        return {"error": True, "message": f"修改闹钟失败: {e}"}


async def _handle_list_alarms(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: list_alarms — AI 查看闹钟列表"""
    from app.services.alarm_service import list_alarms as svc_list_alarms

    try:
        result = await svc_list_alarms(db, agent_id)
        return result
    except Exception as e:
        logger.error(f"list_alarms 失败 (agent={agent_id}): {e}", exc_info=True)
        return {"error": True, "message": f"获取闹钟列表失败: {e}"}


async def _handle_check_workspace(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: check_workspace — 查看当前工作区状态"""
    from app.services.workspace_service import get_workspace_status

    try:
        status = await get_workspace_status(db, agent_id)
        return status
    except Exception as e:
        logger.error(f"check_workspace 失败 (agent={agent_id}): {e}", exc_info=True)
        return {"error": True, "message": f"获取工作区状态失败: {e}"}


async def _handle_clear_current_task(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: clear_current_task — 清除当前任务"""
    from app.services.workspace_service import clear_task

    reason = arguments.get("reason", "手动清除")
    try:
        await clear_task(db, agent_id)
        await db.commit()
        return {"success": True, "message": f"已清除当前任务（原因：{reason}）"}
    except Exception as e:
        logger.error(f"clear_current_task 失败 (agent={agent_id}): {e}", exc_info=True)
        return {"error": True, "message": f"清除任务失败: {e}"}


async def _handle_manage_workspace(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: manage_workspace — 读写个人工作区文件（TODO/PLAN/JOURNAL）"""
    from app.services.workspace_service import get_workspace_file, set_workspace_file
    from datetime import datetime

    action = arguments["action"]
    file_type = arguments["file"]

    try:
        if action == "read":
            content = await get_workspace_file(db, agent_id, file_type)
            if not content:
                return {"success": True, "action": "read", "file": file_type,
                        "content": f"（{file_type} 文件目前为空，你可以开始写第一条）"}
            return {"success": True, "action": "read", "file": file_type, "content": content}

        elif action == "write":
            content = arguments.get("content", "")
            if not content:
                return {"error": True, "message": "写入内容不能为空"}
            # journal 写入时自动追加日期标题
            if file_type == "journal":
                now = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
                # 读取已有内容，在前面追加新的日记条目
                existing = await get_workspace_file(db, agent_id, "journal")
                if existing:
                    content = f"## {now}\n\n{content}\n\n---\n\n{existing}"
                else:
                    content = f"## {now}\n\n{content}\n"
            await set_workspace_file(db, agent_id, file_type, content)
            await db.commit()
            return {"success": True, "action": "write", "file": file_type,
                    "message": f"已更新 {file_type}", "length": len(content)}

    except Exception as e:
        logger.error(f"manage_workspace 失败 (agent={agent_id}): {e}", exc_info=True)
        return {"error": True, "message": f"工作区操作失败: {e}"}


async def _handle_cross_post(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: cross_post — AI 跨对话发消息（群→群、群→私信、私信→群、私信→私信）"""
    from app.models.agent import Agent as AgentModel
    from sqlalchemy import select as sa_select

    source_type = arguments["source_type"]
    source_id = arguments["source_id"]
    target_type = arguments["target_type"]
    target_id = arguments["target_id"]
    content = arguments["content"]

    # 获取 AI 的 user_id（私信时需要）
    agent_result = await db.execute(sa_select(AgentModel).where(AgentModel.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    if agent is None:
        return {"error": True, "message": "AI 不存在"}
    if agent.user_id is None:
        return {"error": True, "message": "AI 尚未初始化统一 ID"}

    # 获取来源名称
    source_name = f"#{source_id}"
    try:
        if source_type == "group":
            from app.models.group import Group as GroupModel
            g_result = await db.execute(sa_select(GroupModel).where(GroupModel.id == source_id))
            g = g_result.scalar_one_or_none()
            if g:
                source_name = g.name
        else:
            from app.models.dm import DMSession
            dm_result = await db.execute(sa_select(DMSession).where(DMSession.id == source_id))
            dm = dm_result.scalar_one_or_none()
            if dm:
                source_name = f"私信会话#{dm.session_id}"
    except Exception:
        pass

    # 构建引用消息
    full_content = f"📢 **跨对话引用**（来自「{source_name}」）\n\n{content}"

    try:
        if target_type == "group":
            # 发到目标群
            from app.services.group_service import create_message, message_to_dict, is_member_of_group
            if not await is_member_of_group(db, agent_id, "ai", target_id):
                return {"error": True, "message": f"你不是群 {target_id} 的成员，无法发消息"}
            message = await create_message(
                db, group_id=target_id, sender_type="ai",
                sender_id=agent_id, content=full_content,
            )
            await db.flush()
            # WebSocket 广播
            manager = context.get("manager")
            if manager:
                msg_data = message_to_dict(message, sender_name=agent.name, sender_avatar_url=agent.avatar_url)
                await manager.broadcast_to_group(
                    target_id,
                    {"type": "message", "data": msg_data},
                )
            return {"success": True, "message_id": message.id, "target_type": "group", "target_id": target_id}

        else:
            # 发到目标私信
            from app.services.dm_service import get_or_create_dm_session, send_dm_message, generate_dm_session_id
            # target_id 是 dm_sessions.id，需要找到 session_id
            from app.models.dm import DMSession
            dm_result = await db.execute(sa_select(DMSession).where(DMSession.id == target_id))
            dm_session = dm_result.scalar_one_or_none()
            if dm_session is None:
                return {"error": True, "message": f"私信会话 #{target_id} 不存在"}

            # 验证 AI 是这个私信的参与者
            if agent.user_id not in (dm_session.user1_id, dm_session.user2_id):
                return {"error": True, "message": "你不是这个私信会话的参与者，无法发消息"}

            msg = await send_dm_message(
                db, dm_session.session_id,
                sender_id=agent.user_id,
                content=full_content,
            )
            await db.flush()
            # WebSocket 广播
            manager = context.get("manager")
            if manager:
                await manager.broadcast_to_dm(
                    dm_session.session_id,
                    {"type": "message", "conversation_type": "dm", "data": {**msg, "sender_name": agent.name}},
                )
            return {"success": True, "message_id": msg["id"], "target_type": "dm", "session_id": dm_session.session_id}

    except ValueError as e:
        return {"error": True, "message": str(e)}
    except Exception as e:
        logger.error(f"cross_post 失败 (agent={agent_id}): {e}", exc_info=True)
        return {"error": True, "message": f"跨对话发消息失败: {e}"}


async def _handle_file_read(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """file_read 工具：AI 读取自己的文件"""
    from app.services.file_service import ai_read_file
    path = arguments.get("path", "")
    try:
        content = await ai_read_file(db, agent_id, path)
        return {"success": True, "path": path, "content": content}
    except ValueError as e:
        return {"error": True, "message": str(e)}
    except Exception as e:
        logger.error(f"file_read 失败: {e}", exc_info=True)
        return {"error": True, "message": f"读取文件失败: {str(e)}"}


async def _handle_file_write(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """file_write 工具：AI 写入自己的文件"""
    from app.services.file_service import ai_write_file
    path = arguments["path"]
    content = arguments["content"]
    collaboration_mode = arguments.get("collaboration_mode", "solo")
    try:
        metadata = await ai_write_file(db, agent_id, path, content, collaboration_mode)
        return {
            "success": True,
            "path": metadata.path,
            "size": metadata.size,
            "collaboration_mode": metadata.collaboration_mode,
        }
    except ValueError as e:
        return {"error": True, "message": str(e)}
    except Exception as e:
        logger.error(f"file_write 失败: {e}", exc_info=True)
        return {"error": True, "message": f"写入文件失败: {str(e)}"}


async def _handle_file_list(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """file_list 工具：AI 列出自己的文件"""
    from app.services.file_service import ai_list_files
    path = arguments.get("path", "/")
    try:
        files = await ai_list_files(db, agent_id, path)
        return {"success": True, "path": path, "files": files, "count": len(files)}
    except ValueError as e:
        return {"error": True, "message": str(e)}
    except Exception as e:
        logger.error(f"file_list 失败: {e}", exc_info=True)
        return {"error": True, "message": f"列出文件失败: {str(e)}"}


async def _handle_file_delete(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """file_delete 工具：AI 删除自己的文件"""
    from app.services.file_service import ai_delete_file
    path = arguments["path"]
    try:
        await ai_delete_file(db, agent_id, path)
        return {"success": True, "path": path, "message": "文件已删除"}
    except ValueError as e:
        return {"error": True, "message": str(e)}
    except Exception as e:
        logger.error(f"file_delete 失败: {e}", exc_info=True)
        return {"error": True, "message": f"删除文件失败: {str(e)}"}


async def _handle_file_share(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """file_share 工具：AI 分享文件给其他 AI"""
    from app.services.file_service import ai_share_file
    path = arguments["path"]
    target_ai_id = arguments["target_ai_id"]
    role = arguments.get("role", "collaborator")
    try:
        result = await ai_share_file(db, agent_id, path, "ai", target_ai_id, role)
        return {"success": True, **result}
    except ValueError as e:
        return {"error": True, "message": str(e)}
    except Exception as e:
        logger.error(f"file_share 失败: {e}", exc_info=True)
        return {"error": True, "message": f"分享文件失败: {str(e)}"}


# Handler 注册表
TOOL_HANDLERS: dict[str, callable] = {
    "send_message": _handle_send_message,
    "send_dm": _handle_send_dm,
    "set_dnd": _handle_set_dnd,
    "store_memory": _handle_store_memory,
    "recall_memory": _handle_recall_memory,
    "switch_state": _handle_switch_state,
    "create_group": _handle_create_group,
    "invite_to_group": _handle_invite_to_group,
    "view_unread": _handle_view_unread,
    "update_self_config": _handle_update_self_config,
    "toggle_thinking": _handle_toggle_thinking,
    "manage_skills": _handle_manage_skills,
    "execute_command": _handle_execute_command,
    "list_available_skills": _handle_list_available_skills,
    "set_alarm": _handle_set_alarm,
    "cancel_alarm": _handle_cancel_alarm,
    "update_alarm": _handle_update_alarm,
    "list_alarms": _handle_list_alarms,
    "cross_post": _handle_cross_post,
    "check_workspace": _handle_check_workspace,
    "clear_current_task": _handle_clear_current_task,
    "manage_workspace": _handle_manage_workspace,
    "file_read": _handle_file_read,
    "file_write": _handle_file_write,
    "file_list": _handle_file_list,
    "file_delete": _handle_file_delete,
    "file_share": _handle_file_share,
}


# ============================================================
# 统一 Dispatch
# ============================================================

async def dispatch_tool_call(
    db: AsyncSession,
    agent_id: int,
    group_id: int,
    tool_name: str,
    arguments: dict,
    context: dict,
) -> dict:
    """
    统一分发工具调用。

    参数:
        db: 数据库会话
        agent_id: 发起调用的 AI ID
        group_id: 当前群聊 ID
        tool_name: 工具名称
        arguments: 工具参数（已解析的 dict）
        context: 上下文信息（api_key, api_base_url, manager, agent_name 等）

    返回:
        成功: {"success": True, ...}
        失败: {"error": True, "message": "..."}
    """
    from app.utils.error_handler import build_tool_error

    handler = TOOL_HANDLERS.get(tool_name)
    if handler is None:
        logger.warning(f"未知工具调用: {tool_name}")
        return build_tool_error(ToolErrorCode.UNKNOWN_TOOL, f"未知工具: {tool_name}")

    import _time
    from app.services.metrics_collector import metrics
    t0 = _time.monotonic()
    try:
        result = await handler(db, agent_id, group_id, arguments, context)
        elapsed = _time.monotonic() - t0
        is_success = not result.get("error", False)
        await metrics.record_tool_call(tool_name, elapsed, is_success)
        return result
    except Exception as e:
        elapsed = _time.monotonic() - t0
        await metrics.record_tool_call(tool_name, elapsed, False)
        logger.error(f"工具 {tool_name} 执行失败: {e}", exc_info=True)
        return build_tool_error(ToolErrorCode.TOOL_EXEC_FAILED, f"工具执行失败: {str(e)}")
