"""
AI 自动回复 Worker
消费 message_queue，对每条新消息检查各 AI 回复意愿，调用 LLM 生成回复
"""
import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from sqlalchemy import select
from app.database import async_session
from app.models.agent import Agent as AgentModel
from app.models.group import Group, GroupMember
from app.models.user import User
from app.config import settings

logger = logging.getLogger(__name__)

# 全局消息队列（ws.py 推送，worker 消费）
message_queue: asyncio.Queue = asyncio.Queue(maxsize=500)

# 速率限制：{agent_id: last_call_timestamp}
_rate_limit_tracker: dict[int, float] = {}

# 导入连接管理器（在 ws.py 中初始化的全局实例）
from app.routers.ws import manager


async def ai_response_worker():
    """
    后台主循环：持续消费消息队列，为每条消息检查并触发 AI 回复。
    在 main.py lifespan 中通过 asyncio.create_task 启动。
    """
    logger.info("🤖 AI 回复 worker 已启动，等待消息事件...")
    while True:
        try:
            event = await message_queue.get()
            logger.info(f"📬 Worker 收到事件: group={event.get('group_id')}, msg={event.get('message_id')}, queue_remaining={message_queue.qsize()}")
            async with async_session() as db:
                try:
                    await _process_event(db, event)
                except Exception as e:
                    logger.error(f"处理消息事件失败: {e}", exc_info=True)
            message_queue.task_done()
        except asyncio.CancelledError:
            logger.info("AI 回复 worker 正在关闭...")
            break
        except Exception as e:
            logger.error(f"Worker 循环异常: {e}", exc_info=True)
            await asyncio.sleep(1)  # 防止死循环


async def _process_event(db, event: dict):
    """
    处理单条消息事件。

    event 字段:
        group_id, message_id, content, sender_type, sender_id, chain_depth

    触发规则:
    - 人类消息 → 所有 AI 成员检查回复意愿（chain_depth=0）
    - AI 消息 → 所有其他 AI 成员检查回复意愿（靠意愿分自然筛选）
    - 对话链深度限制：chain_depth > 2 时停止，防止无限循环
    """
    group_id = event["group_id"]
    message_id = event["message_id"]
    content = event["content"]
    sender_type = event.get("sender_type", "human")
    sender_id = event.get("sender_id")
    chain_depth = event.get("chain_depth", 0)

    # 获取群聊信息
    group_result = await db.execute(select(Group).where(Group.id == group_id))
    group = group_result.scalar_one_or_none()
    if group is None:
        return

    # 对话链深度限制：根据群设置动态计算
    if group.owner_type == "ai":
        # AI 自建群不限制发言频率（安全上限 50）
        effective_max_depth = 50
    else:
        # 人类群聊：根据群设置计算
        limit_per_min = group.speak_limit_per_minute or 0
        window_sec = group.speak_limit_window_seconds or 120
        if limit_per_min > 0:
            # 时间窗口内最多 limit_per_min 条，每条至少引发一轮对话，预留 2x 余量
            effective_max_depth = max(limit_per_min * 2, 5)
        else:
            # 不限 → 使用安全上限
            effective_max_depth = 50

    if chain_depth > effective_max_depth:
        logger.info(
            f"群 {group_id} 对话链深度 {chain_depth} > {effective_max_depth}"
            f"(owner={group.owner_type}, limit={group.speak_limit_per_minute}/min)，停止触发"
        )
        return

    # 获取群聊中所有 AI 成员
    members_result = await db.execute(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.member_type == "ai",
        )
    )
    ai_members = members_result.scalars().all()

    if not ai_members:
        return

    # 确定需要触发的 AI 列表
    target_ai_ids: set[int] = set()

    if sender_type == "human":
        # 人类消息 → 所有 AI 都检查
        target_ai_ids = {m.member_id for m in ai_members}
    else:
        # AI 消息 → 触发所有其他 AI（靠意愿分自然筛选）
        # @提及 会在意愿分中给予 +40 加成，而非 @ 的 AI 也有基础分参与
        target_ai_ids = {
            m.member_id for m in ai_members
            if m.member_id != sender_id  # 排除自己
        }

    if not target_ai_ids:
        return

    logger.info(
        f"群聊 {group_id} 收到消息 (sender={sender_type}:{sender_id}, depth={chain_depth})，"
        f"触发 {len(target_ai_ids)} 个 AI: {target_ai_ids}"
    )

    next_depth = chain_depth + 1
    for ai_id in target_ai_ids:
        await _maybe_trigger_ai_reply(
            db, ai_id, group_id, group, content, message_id,
            chain_depth=next_depth,
        )


async def _maybe_trigger_ai_reply(
    db, agent_id: int, group_id: int, group, content: str, trigger_message_id: int,
    chain_depth: int = 0,
):
    """检查单个 AI 是否应该回复，如果是则调用 LLM 生成回复"""
    from app.services.agent_service import get_agent, calculate_willingness
    from app.services.group_service import is_member_in_dnd, store_pending_message

    agent = await get_agent(db, agent_id)
    if agent is None:
        logger.warning(f"AI agent_id={agent_id} 不存在，跳过")
        return

    logger.info(f"🔍 检查 AI {agent.name}({agent_id}), state={agent.state}")

    # 1. blocked → 硬屏蔽，任何情况不回复
    if agent.state == "blocked":
        logger.info(f"AI {agent.name}({agent_id}) 状态为 blocked，跳过")
        return

    # 2. @提及检测（需要在离线/DND 判断前执行，因为 @提及可以唤醒离线 AI）
    is_mentioned = _check_mention(content, agent.name)

    # 3. 离线 + 未被 @ → 跳过；离线 + 被 @ → 唤醒为 active
    if agent.state == "offline":
        if not is_mentioned:
            logger.info(f"AI {agent.name}({agent_id}) 状态为 offline，跳过")
            return
        # @提及唤醒离线 AI
        logger.info(f"AI {agent.name}({agent_id}) 被 @提及，从 offline 唤醒为 active")
        from app.services.agent_service import switch_agent_state
        await switch_agent_state(db, agent_id=agent_id, target_state="active", reason="被 @提及唤醒")
        await db.flush()

    # 4. DND 检查
    in_dnd = await is_member_in_dnd(db, agent_id, group_id)
    logger.info(f"🔍 AI {agent.name}({agent_id}): in_dnd={in_dnd}, is_mentioned={is_mentioned}")

    if in_dnd and not is_mentioned:
        # DND 且未被 @ → 暂存消息
        await store_pending_message(db, agent_id, group_id, trigger_message_id)
        logger.info(f"AI {agent.name}({agent_id}) 在 DND，消息已暂存")
        return

    # 3. 计算意愿
    willingness = await calculate_willingness(db, agent_id, group_id, content)
    threshold = agent.auto_dnd_threshold or settings.default_auto_dnd_threshold
    logger.info(f"🔍 AI {agent.name}({agent_id}): willingness={willingness}, threshold={threshold}")

    if willingness < threshold:
        logger.info(
            f"AI {agent.name}({agent_id}) 意愿分 {willingness} < {threshold}，跳过"
        )
        # 自动 DND（如果意愿过低且非 @ 提及）
        if willingness < threshold // 2 and not is_mentioned:
            from app.services.group_service import set_group_dnd
            try:
                await set_group_dnd(
                    db, agent_id, group_id,
                    duration_minutes=agent.auto_dnd_duration or settings.default_auto_dnd_duration,
                )
                logger.info(f"AI {agent.name}({agent_id}) 自动进入 DND")
            except Exception:
                pass
        return

    # 4. 速率限制检查
    if not _check_rate_limit(agent_id):
        logger.info(f"AI {agent.name}({agent_id}) 速率限制，跳过")
        return

    # 5. 获取 API 配置
    user_result = await db.execute(select(User).where(User.id == agent.owner_id))
    user = user_result.scalar_one_or_none()
    from app.utils.crypto import decrypt_api_key
    api_key = decrypt_api_key(user.api_key_encrypted) if user and user.api_key_encrypted else None
    api_base = user.api_base_url if user and user.api_base_url else settings.deepseek_base_url
    logger.info(f"🔍 AI {agent.name}: api_base={api_base}, has_api_key={api_key is not None}")

    # 6. 构建消息
    from app.services.llm_service import build_messages, resolve_model
    # 向量加速混合检索仅在 AI 全群启用（AI 内部协作场景）
    # 普通人类群聊使用常规历史窗口，避免不必要的向量化开销
    from app.services.group_service import is_ai_only_group
    ai_only = await is_ai_only_group(db, group_id, group=group)
    use_vector = group.is_vector_accelerated and ai_only
    if group.is_vector_accelerated and not ai_only:
        logger.info(f"群 {group_id} 含人类成员，跳过向量加速（使用常规历史窗口）")
    messages = await build_messages(
        db, agent, group_id,
        vector_accelerated=use_vector,
        api_base_url=api_base,
        api_key=api_key,
    )
    logger.info(f"🔍 AI {agent.name}: 构建了 {len(messages)} 条消息")

    # 7. 获取工具
    from app.services.tool_registry import get_allowed_tools
    tools = get_allowed_tools(agent.state)
    model = resolve_model(agent)
    logger.info(f"🔍 AI {agent.name}: model={model}, tools={len(tools)}")

    # 8. 工具调用循环（含思考状态广播）
    logger.info(f"🚀 AI {agent.name}: 开始调用 LLM...")
    try:
        await manager.broadcast_to_group(
            group_id,
            {
                "type": "ai_thinking",
                "data": {
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "group_id": group_id,
                },
            },
        )
        await _tool_call_loop(
            db=db,
            agent=agent,
            group_id=group_id,
            messages=messages,
            tools=tools,
            model=model,
            api_base_url=api_base,
            api_key=api_key,
            chain_depth=chain_depth,
        )
    finally:
        await manager.broadcast_to_group(
            group_id,
            {
                "type": "ai_thinking_end",
                "data": {
                    "agent_id": agent.id,
                    "group_id": group_id,
                },
            },
        )
    logger.info(f"✅ AI {agent.name}: LLM 调用完成")

    # 9. 标记未读消息已处理
    from app.services.group_service import mark_pending_read
    await mark_pending_read(db, agent_id, group_id)
    await db.commit()


async def _tool_call_loop(
    db,
    agent,
    group_id: int,
    messages: list[dict],
    tools: list[dict],
    model: str,
    api_base_url: str,
    api_key: str | None,
    max_loops: int = 5,
    chain_depth: int = 0,
):
    """
    工具调用循环：LLM 返回 tool_calls → 执行 → 将结果回传 → LLM 再决定

    流程：
    1. 调用 LLM
    2. 如果有 text content → 创建 AI 消息，广播到群聊
    3. 如果有 tool_calls → 执行工具，结果追加到 messages，回到步骤 1
    4. 如果都没有 → 退出循环
    """
    from app.services.llm_service import chat_completion
    from app.services.tool_registry import dispatch_tool_call

    context = {
        "api_key": api_key,
        "api_base_url": api_base_url,
        "manager": manager,
        "agent_name": agent.name,
        "chain_depth": chain_depth,
    }

    for loop_idx in range(max_loops):
        try:
            response = await chat_completion(
                messages=messages,
                model=model,
                api_base_url=api_base_url,
                api_key=api_key,
                tools=tools if tools else None,
                temperature=agent.current_temperature or 0.8,
                top_p=agent.current_top_p or 0.9,
                presence_penalty=agent.current_presence_penalty or 0.5,
                frequency_penalty=agent.current_frequency_penalty or 0.5,
            )
        except Exception as e:
            logger.error(f"AI {agent.name}({agent.id}) LLM 调用失败: {e}")
            return

        content = response.get("content")
        tool_calls = response.get("tool_calls")
        finish_reason = response.get("finish_reason", "stop")

        # 有文本内容 → 发送消息 + 触发其他 AI
        if content:
            from app.services.group_service import create_message, message_to_dict
            try:
                message = await create_message(
                    db, group_id=group_id, sender_type="ai",
                    sender_id=agent.id, content=content,
                )
                await db.flush()

                msg_data = message_to_dict(message, sender_name=agent.name)
                await manager.broadcast_to_group(
                    group_id,
                    {"type": "message", "data": msg_data},
                )

                # 推入队列触发其他 AI 回复（对话链）
                next_depth = chain_depth + 1
                try:
                    message_queue.put_nowait({
                        "group_id": group_id,
                        "message_id": message.id,
                        "content": content,
                        "sender_type": "ai",
                        "sender_id": agent.id,
                        "chain_depth": next_depth,
                    })
                except asyncio.QueueFull:
                    pass

                # 自动提取关键信息存储为记忆（安全网：AI 忘了调用 store_memory 工具时兜底）
                try:
                    from app.services.memory_service import auto_extract_key_facts
                    await auto_extract_key_facts(
                        db, agent.id, group_id, content,
                        sender_name=agent.name,
                        api_base_url=api_base_url,
                        api_key=api_key,
                    )
                except Exception:
                    pass  # 自动提取失败不影响主流程

                logger.info(f"AI {agent.name}({agent.id}) 回复: {content[:80]}...")
            except Exception as e:
                logger.error(f"AI {agent.name} 消息发送失败: {e}")

        # 无工具调用 → 退出
        if not tool_calls:
            return

        # 处理工具调用
        # 将 assistant 消息（含 tool_calls）追加到 messages
        assistant_msg = {"role": "assistant", "content": content}
        assistant_msg["tool_calls"] = tool_calls
        messages.append(assistant_msg)

        for tc in tool_calls:
            tc_id = tc.get("id", "")
            func_info = tc.get("function", {})
            tool_name = func_info.get("name", "")
            arguments_str = func_info.get("arguments", "{}")

            try:
                arguments = json.loads(arguments_str)
            except json.JSONDecodeError:
                arguments = {}

            logger.info(f"AI {agent.name} 调用工具: {tool_name}({arguments})")

            result = await dispatch_tool_call(
                db, agent.id, group_id, tool_name, arguments, context,
            )

            # 将工具结果追加到 messages
            messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": json.dumps(result, ensure_ascii=False),
            })

        # 如果 finish_reason 是 "tool_calls"，继续循环让 LLM 处理工具结果
        if finish_reason != "tool_calls" and loop_idx >= max_loops - 1:
            return

        # 短暂延迟，避免过于频繁的 API 调用
        await asyncio.sleep(0.5)


from app.utils.text import extract_mentions as _extract_mentions, check_mention as _check_mention


def _check_rate_limit(agent_id: int) -> bool:
    """
    检查速率限制（简单内存实现）。
    返回 True 表示允许调用。
    """
    now = time.monotonic()
    last_call = _rate_limit_tracker.get(agent_id, 0)
    min_interval = 1.0 / settings.rate_limit_per_second

    if now - last_call < min_interval:
        return False

    _rate_limit_tracker[agent_id] = now
    return True
