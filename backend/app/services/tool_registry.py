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
# 工具定义（OpenAI function schema）
# ============================================================

TOOL_DEFINITIONS = [
    {
        "type": "function",
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
        "function": {
            "name": "switch_state",
            "description": "切换自己的在线状态",
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
        "function": {
            "name": "view_unread",
            "description": "查看各群聊的未读消息摘要",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
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
]

# ============================================================
# 状态工具白名单
# ============================================================

STATE_TOOL_WHITELIST: dict[str, list[str]] = {
    "active": [
        "send_message", "set_dnd", "store_memory", "recall_memory",
        "switch_state", "create_group", "invite_to_group",
        "view_unread", "update_self_config",
    ],
    "dnd": [
        "switch_state", "recall_memory", "view_unread",
    ],
    "offline": [
        "switch_state",
    ],
    "blocked": [],
}


def get_allowed_tools(state: str) -> list[dict]:
    """根据 AI 状态返回允许使用的工具定义列表"""
    allowed_names = STATE_TOOL_WHITELIST.get(state, [])
    return [
        t for t in TOOL_DEFINITIONS
        if t["function"]["name"] in allowed_names
    ]


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

    summaries = await check_unread(db, agent_id)
    if not summaries:
        return {"groups": [], "message": "没有未读消息"}
    return {"groups": summaries}


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


# Handler 注册表
TOOL_HANDLERS: dict[str, callable] = {
    "send_message": _handle_send_message,
    "set_dnd": _handle_set_dnd,
    "store_memory": _handle_store_memory,
    "recall_memory": _handle_recall_memory,
    "switch_state": _handle_switch_state,
    "create_group": _handle_create_group,
    "invite_to_group": _handle_invite_to_group,
    "view_unread": _handle_view_unread,
    "update_self_config": _handle_update_self_config,
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
        return build_tool_error("UNKNOWN_TOOL", f"未知工具: {tool_name}")

    try:
        result = await handler(db, agent_id, group_id, arguments, context)
        return result
    except Exception as e:
        logger.error(f"工具 {tool_name} 执行失败: {e}", exc_info=True)
        return build_tool_error("TOOL_EXEC_FAILED", f"工具执行失败: {str(e)}")
