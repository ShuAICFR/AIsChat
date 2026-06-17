"""
工具注册表
定义 AI 可用的所有工具（OpenAI function calling 格式）、状态白名单、统一 dispatch
"""
import asyncio
import json
import logging
from datetime import datetime, timezone
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
        "description": "在群聊和私信中发言、加好友发私信、切换在线状态、管理免打扰",
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
            "description": "向好友发送私信。如果你和某人是好友，可以直接私聊他/她。私信是一对一的，其他人看不到。发送后对方会立即收到通知。你需要知道对方的 user_id（可通过好友列表查询）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_user_id": {
                        "type": "integer",
                        "description": "对方的 users.id（统一 ID，人类和 AI 都在 users 表中）。可通过好友列表或之前的对话获知。",
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
            "description": "修改自己的配置（性格、温度等）",
            "parameters": {
                "type": "object",
                "properties": {
                    "system_prompt": {
                        "type": "string",
                        "nullable": True,
                        "description": "新的系统提示词",
                    },
                    "temperature": {
                        "type": "number",
                        "nullable": True,
                        "description": "采样温度 0-2",
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
        "segment": "file_operations",
        "function": {
            "name": "execute_command",
            "description": "通过 OpenCLI 执行命令。OpenCLI 是一个命令行工具，能操控浏览器访问网页、调用外部 CLI（GitHub/Docker/Obsidian 等）。常用子命令：browser（浏览器操作，如 browser open/click/type/get/screenshot）、gh（GitHub CLI）、docker、obsidian。注意：可用的命令名称由管理员配置的白名单控制，不在白名单中的命令会被拒绝。",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "要执行的命令名称（如 browser open、browser get、gh repo、docker ps 等）。先调用 opencli list 可查看完整命令列表",
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
            "name": "send_friend_request",
            "description": "向某人发送好友申请。加上好友之后，你们就能互相发私信（DM）了。在群聊里看到想私聊的人，可以用这个工具先加好友。注意：friend_type 和 friend_id 可以从群聊消息格式「名字(ID:数字)」中获取。",
            "parameters": {
                "type": "object",
                "properties": {
                    "friend_type": {
                        "type": "string",
                        "enum": ["human", "ai"],
                        "description": "好友类型：human（人类用户）或 ai（AI 角色）",
                    },
                    "friend_id": {
                        "type": "integer",
                        "description": "对方的用户 ID（人类）或 AI ID。从消息格式「名字(ID:数字)」中可以获取。",
                    },
                    "message": {
                        "type": "string",
                        "nullable": True,
                        "description": "附言（可选，如「你好，我是XX，想加你好友」）",
                    },
                },
                "required": ["friend_type", "friend_id"],
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
        "send_message", "send_dm", "send_friend_request",
        "set_dnd", "store_memory", "recall_memory",
        "switch_state", "create_group", "invite_to_group",
        "view_unread", "update_self_config", "toggle_thinking",
        "execute_command", "list_available_skills",
    ],
    "dnd": [
        "switch_state", "recall_memory", "view_unread", "toggle_thinking",
        "execute_command", "list_available_skills",
    ],
    "offline": [
        "switch_state", "list_available_skills",
    ],
    "blocked": [],
}


def get_allowed_tools(state: str, thinking_enabled: bool | None = None) -> list[dict]:
    """根据 AI 状态返回允许使用的工具定义列表。

    thinking_enabled 为 False 时，过滤掉 toggle_thinking 工具（省 token，防止 AI 擅自开启）。
    为 None 时不额外过滤（保持向后兼容）。
    """
    allowed_names = STATE_TOOL_WHITELIST.get(state, [])
    tools = [
        t for t in TOOL_DEFINITIONS
        if t["function"]["name"] in allowed_names
    ]
    if thinking_enabled is False:
        tools = [t for t in tools if t["function"]["name"] != "toggle_thinking"]
    return tools


# ============================================================
# 工具 Handler 函数
# ============================================================

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
    msg_data = message_to_dict(message, sender_name=agent_name)
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
    """工具: store_memory"""
    from app.models.memory import RoughMemory, DetailMemory
    from app.utils.embedding import get_embedding

    title = arguments["title"]
    content = arguments["content"]
    scope = arguments["scope"]
    mem_group_id = arguments.get("group_id", group_id if scope == "group" else None)

    # 向量化标题
    api_key = context.get("api_key")
    api_base = context.get("api_base_url", "https://api.deepseek.com")

    try:
        embedding = await get_embedding(title, api_base_url=api_base, api_key=api_key)
    except Exception as e:
        logger.warning(f"记忆向量化失败，使用空向量: {e}")
        embedding = None

    rough = RoughMemory(
        owner_type="ai",
        owner_id=agent_id,
        title=title,
        embedding=embedding,
        scope=scope,
        group_id=mem_group_id,
    )
    db.add(rough)
    await db.flush()

    detail = DetailMemory(
        rough_id=rough.id,
        content=content,
    )
    db.add(detail)
    await db.commit()

    return {"success": True, "rough_id": rough.id, "title": title}


async def _handle_recall_memory(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: recall_memory"""
    from sqlalchemy import text
    from app.utils.embedding import get_embedding

    query = arguments["query"]
    scope = arguments["scope"]
    top_k = min(arguments.get("top_k", 5), 20)
    mem_group_id = arguments.get("group_id", group_id)

    api_key = context.get("api_key")
    api_base = context.get("api_base_url", "https://api.deepseek.com")

    # 向量化查询
    try:
        query_embedding = await get_embedding(query, api_base_url=api_base, api_key=api_key)
    except Exception as e:
        return {"error": True, "message": f"查询向量化失败: {e}"}

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
    memories = [
        {
            "id": row.id,
            "title": row.title,
            "scope": row.scope,
            "similarity": round(float(row.similarity), 4) if row.similarity else None,
            "content": (row.content[:200] + "...") if row.content and len(row.content) > 200 else (row.content or ""),
        }
        for row in result
    ]

    if not memories:
        return {"memories": [], "message": "未找到相关记忆"}

    return {"memories": memories}


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

    updates = {}
    if "system_prompt" in arguments and arguments["system_prompt"] is not None:
        updates["system_prompt"] = arguments["system_prompt"]
    if "temperature" in arguments and arguments["temperature"] is not None:
        updates["temperature"] = arguments["temperature"]

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
        return {"success": True, "message": "配置已更新"}
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


async def _handle_send_dm(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: send_dm — AI 向好友发送私信（v1.1.2: 使用统一 ID）"""
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


async def _handle_send_friend_request(
    db: AsyncSession, agent_id: int, group_id: int,
    arguments: dict, context: dict,
) -> dict:
    """工具: send_friend_request — AI 向某人发送好友申请"""
    from app.services.friend_service import send_friend_request
    from app.models.agent import Agent as AgentModel
    from sqlalchemy import select as sa_select

    friend_type = arguments["friend_type"]
    friend_id = arguments["friend_id"]
    message = arguments.get("message")

    # AI 不能加自己为好友
    if friend_type == "ai" and friend_id == agent_id:
        return {"error": True, "message": "不能加自己为好友"}

    # 获取 AI 的 owner（以 owner 身份发送好友申请）
    agent_result = await db.execute(
        sa_select(AgentModel).where(AgentModel.id == agent_id)
    )
    agent = agent_result.scalar_one_or_none()
    if agent is None:
        return {"error": True, "message": "AI 代理不存在"}

    try:
        result = await send_friend_request(
            db,
            requester_id=agent.owner_id,
            target_type=friend_type,
            target_id=friend_id,
            message=message,
        )
        await db.commit()

        if result.get("auto"):
            return {
                "success": True,
                "message": f"对方已经向你发送过好友申请，已自动成为好友！现在可以用 send_dm 私信了。",
                "auto_accepted": True,
            }
        return {
            "success": True,
            "message": f"好友申请已发送给 {friend_type}:{friend_id}，等待对方接受。",
            "request_id": result.get("request_id"),
        }
    except ValueError as e:
        return {"error": True, "message": str(e)}


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
    current_tools = get_allowed_tools(current_state, thinking_enabled=thinking_enabled)
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
    "execute_command": _handle_execute_command,
    "list_available_skills": _handle_list_available_skills,
    "send_friend_request": _handle_send_friend_request,
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

    try:
        result = await handler(db, agent_id, group_id, arguments, context)
        return result
    except Exception as e:
        logger.error(f"工具 {tool_name} 执行失败: {e}", exc_info=True)
        return build_tool_error(ToolErrorCode.TOOL_EXEC_FAILED, f"工具执行失败: {str(e)}")
