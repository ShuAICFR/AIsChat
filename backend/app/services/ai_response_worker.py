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
        conversation_type ("group" | "dm"), group_id (群聊), session_id (私信),
        message_id, content, sender_type, sender_id, chain_depth
    """
    event_type = event.get("type", "")
    if event_type == "alarm":
        await _process_alarm_event(db, event)
        return

    conversation_type = event.get("conversation_type", "group")

    if conversation_type == "dm":
        await _process_dm_event(db, event)
    else:
        await _process_group_event(db, event)


async def _process_dm_event(db, event: dict):
    """处理私信事件：检查对方是否是 AI，如果是则触发回复"""
    session_id = event["session_id"]
    message_id = event["message_id"]
    content = event["content"]
    sender_id = event.get("sender_id")
    chain_depth = event.get("chain_depth", 0)

    from app.models.dm import DMSession
    from app.models.user import User
    from app.models.agent import Agent as AgentModel

    # 找到会话
    sess_result = await db.execute(
        select(DMSession).where(DMSession.session_id == session_id)
    )
    session = sess_result.scalar_one_or_none()
    if session is None:
        return

    # 找到接收方
    receiver_id = session.user2_id if session.user1_id == sender_id else session.user1_id

    # 检查是否是 AI
    user_result = await db.execute(
        select(User).where(User.id == receiver_id, User.type == "ai")
    )
    ai_user = user_result.scalar_one_or_none()
    if ai_user is None:
        return

    # 找到对应的 agent
    agent_result = await db.execute(
        select(AgentModel).where(AgentModel.user_id == receiver_id)
    )
    agent = agent_result.scalar_one_or_none()
    if agent is None:
        return

    logger.info(f"私信 {session_id} 触发 AI {agent.name}({agent.id}) 回复")

    # DM 链条深度限制
    if chain_depth > 10:
        logger.info(f"DM {session_id} 对话链深度 {chain_depth} > 10，停止")
        return

    # 简化的 DM 回复触发（不需要群聊那样的 DND/意愿检查）
    await _trigger_dm_ai_reply(
        db, agent, session_id, content, message_id,
        chain_depth=chain_depth + 1,
        sender_id=sender_id,
    )


async def _process_group_event(db, event: dict):
    """处理群聊事件（原有逻辑）"""
    group_id = event["group_id"]
    message_id = event["message_id"]
    content = event["content"]
    sender_type = event.get("sender_type", "human")
    sender_id = event.get("sender_id")
    chain_depth = event.get("chain_depth", 0)

    # 远程消息门控：来自远程实例的 AI 消息不触发本地 AI 回复（防循环）
    source_public_id = event.get("source_public_id")
    if source_public_id and sender_type == "ai":
        logger.info(f"群 {group_id} 收到远程 AI 消息 (source={source_public_id})，跳过本地 AI 回复")
        return

    # 获取群聊信息
    group_result = await db.execute(select(Group).where(Group.id == group_id))
    group = group_result.scalar_one_or_none()
    if group is None:
        return

    # 对话链深度限制：根据群设置动态计算
    if group.owner_type == "ai":
        effective_max_depth = 50
    else:
        limit_per_min = group.speak_limit_per_minute or 0
        window_sec = group.speak_limit_window_seconds or 120
        if limit_per_min > 0:
            effective_max_depth = max(limit_per_min * 2, 5)
        else:
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
        target_ai_ids = {m.member_id for m in ai_members}
    else:
        target_ai_ids = {
            m.member_id for m in ai_members
            if m.member_id != sender_id
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
            sender_type=sender_type,
            sender_id=sender_id,
        )


async def _maybe_trigger_ai_reply(
    db, agent_id: int, group_id: int, group, content: str, trigger_message_id: int,
    chain_depth: int = 0,
    sender_type: str = "human",
    sender_id: int | None = None,
):
    """检查单个 AI 是否应该回复，如果是则调用 LLM 生成回复"""
    from app.services.agent_service import get_agent, calculate_willingness, WillingnessResult
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
    logger.info(f"🔍 AI {agent.name}({agent_id}): is_mentioned={is_mentioned}, content_preview='{content[:80]}'")

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

    # 3. 计算意愿（v0.4.0: WillingnessResult 含逐因子原因 + 行为级别）
    w = await calculate_willingness(db, agent_id, group_id, content)
    logger.info(f"🔍 AI {agent.name}({agent_id}): {w.score}分 [{w.level}] — {w.reason}")

    # 保存最近意愿评分到 agent
    agent.last_willingness_score = w.score
    agent.last_willingness_reason = w.reason

    # @提及强制回复（HIGH/MEDIUM 级），LOW 级跳过
    if not is_mentioned and w.level == "low":
        logger.info(f"AI {agent.name}({agent_id}) 意愿过低({w.score})，跳过")
        return

    # MEDIUM 级别仅 @提及回复（已在 is_mentioned 分支处理）
    if not is_mentioned and w.level == "medium":
        logger.info(f"AI {agent.name}({agent_id}) 中意愿({w.score})，仅 @提及 时回复")
        return

    # 4. 速率限制检查
    if not _check_rate_limit(agent_id):
        logger.info(f"AI {agent.name}({agent_id}) 速率限制，跳过")
        return

    # 5. 获取 API 配置
    user_result = await db.execute(select(User).where(User.id == agent.owner_id))
    user = user_result.scalar_one_or_none()
    from app.utils.crypto import decrypt_api_key
    # 优先级：Agent 级配置 > User 全局配置
    api_key = None
    api_base = settings.deepseek_base_url
    if agent.api_key_encrypted:
        api_key = decrypt_api_key(agent.api_key_encrypted)
        api_base = agent.api_base_url or settings.deepseek_base_url
    elif user and user.api_key_encrypted:
        api_key = decrypt_api_key(user.api_key_encrypted)
        api_base = user.api_base_url or settings.deepseek_base_url
    logger.info(f"🔍 AI {agent.name}: api_base={api_base}, has_api_key={api_key is not None}")

    # 5.5. 中断标记：如果 AI 之前在忙，记录中断
    try:
        from app.services.workspace_service import mark_interrupted
        sender_info = f"群聊 #{group_id} 的新消息"
        await mark_interrupted(db, agent_id, reason=sender_info)
    except Exception:
        pass  # 非致命

    # 5.6. Skill 引擎评估（延迟回复、打字指示器）
    from app.services.skill_engine import evaluate_action_skills, _is_delay_reply_allowed
    skill_result = await evaluate_action_skills(db, agent, group_id, context={
        "content": content,
        "sender_type": sender_type,
        "sender_id": sender_id,
    })
    # 打字指示器广播
    if skill_result.show_typing:
        await manager.broadcast_to_group(group_id, {
            "type": "ai_typing",
            "data": {"agent_id": agent.id, "agent_name": agent.name, "is_typing": True},
        })
    # 延迟回复（若已有积压消息则跳过，避免级联延迟）
    delay_skipped = False
    if skill_result.delay_seconds > 0:
        from app.services.group_service import get_pending_messages
        pending = await get_pending_messages(db, agent_id, group_id)
        pending_count = len(pending) if pending else 0
        if pending_count > 0:
            logger.info(f"🧠 AI {agent.name} 有 {pending_count} 条积压消息，跳过延迟回复")
            delay_skipped = True
        else:
            logger.info(f"🧠 AI {agent.name} 技能延迟 {skill_result.delay_seconds}s")
            await asyncio.sleep(skill_result.delay_seconds)

    # v0.4.0: trigger_user_id 用于通用/半通用 AI 的 per-user 记忆隔离
    trigger_user_id = sender_id if sender_type == "human" else None

    # 6. 获取有效配置（v0.4.0: per-user 覆盖 — 需在 build_messages 前获取）
    from app.services.agent_service import get_effective_config
    effective_cfg = await get_effective_config(db, agent.id, trigger_user_id)
    logger.info(f"🔍 AI {agent.name}: effective_cfg ai_type={effective_cfg['ai_type']}, "
                f"thinking={effective_cfg['thinking_enabled']}, temp={effective_cfg['temperature']}")

    # 7. 构建消息
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
        trigger_user_id=trigger_user_id,
        system_prompt_override=effective_cfg.get("system_prompt"),
    )
    logger.info(f"🔍 AI {agent.name}: 构建了 {len(messages)} 条消息")

    # 延迟被跳过时，注入提醒：加快回复速度 + 记入记忆
    if delay_skipped:
        delay_hint = (
            "⚠️ 系统提醒：你配置了延迟回复，但因为群里有积压消息，延迟已被跳过。\n"
            "请检查最近的发消息者——对方可能正在等你回复。\n"
            "建议：\n"
            "1. 加快对此人的回复速度，不要再设长延迟\n"
            "2. 调用 manage_workspace 在 todo 里记下「被催促回复，需要调整回复节奏」\n"
            "3. 调用 store_memory 记下这个交互模式，以后遇到此人时优先快速响应"
        )
        messages.append({"role": "system", "content": delay_hint})

    # 7.5 获取工具
    from app.services.tool_registry import get_allowed_tools
    delay_allowed = await _is_delay_reply_allowed(db, agent)
    tools = get_allowed_tools(agent.state, thinking_enabled=effective_cfg["thinking_enabled"], delay_reply_allowed=delay_allowed)
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
            max_loops=effective_cfg["max_tool_rounds"],
            chain_depth=chain_depth,
            conversation_type="group",
            trigger_user_id=trigger_user_id,
            effective_cfg=effective_cfg,
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
    group_id: int | None,
    messages: list[dict],
    tools: list[dict],
    model: str,
    api_base_url: str,
    api_key: str | None,
    max_loops: int = 3,
    chain_depth: int = 0,
    conversation_type: str = "group",
    session_id: str | None = None,
    trigger_user_id: int | None = None,
    effective_cfg: dict | None = None,
):
    """
    工具调用循环：LLM 必须通过工具调用来执行所有操作（包括发消息）。

    铁律：文字不能自动发出去。想说话必须调 send_message。

    v0.4.0: trigger_user_id 传入工具上下文供 store_memory 做 per-user 隔离。
    effective_cfg 为 get_effective_config 的返回值，提供 per-user 定制的 LLM 参数。
    """
    if effective_cfg is None:
        effective_cfg = {}
    from app.services.llm_service import chat_completion
    from app.services.tool_registry import dispatch_tool_call

    context = {
        "api_key": api_key,
        "api_base_url": api_base_url,
        "manager": manager,
        "agent_name": agent.name,
        "chain_depth": chain_depth,
        "conversation_type": conversation_type,
        "session_id": session_id,
        "trigger_user_id": trigger_user_id,
    }

    # 追踪 AI 在做什么（用于中断恢复）
    last_task = None
    # 累积 token 消耗（跨多轮工具调用）
    total_usage: dict[str, int] = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    # system_reminder 额外轮次：AI 返回文字但忘了调 send_message 时，提醒不消耗配额
    _reminder_extra = 0

    loop_idx = 0
    while loop_idx < max_loops + _reminder_extra:
        try:
            response = await chat_completion(
                messages=messages,
                model=model,
                api_base_url=api_base_url,
                api_key=api_key,
                tools=tools if tools else None,
                temperature=effective_cfg["temperature"] or 0.8,
                top_p=effective_cfg["top_p"] or 0.9,
                presence_penalty=effective_cfg["presence_penalty"] or 0.5,
                frequency_penalty=effective_cfg["frequency_penalty"] or 0.5,
                thinking_enabled=effective_cfg["thinking_enabled"],
            )
        except Exception as e:
            logger.error(f"AI {agent.name}({agent.id}) LLM 调用失败: {e}")
            await _save_conversation_log_safe(
                db, agent, messages, conversation_type,
                group_id, session_id, has_output=False, model=model,
            )
            return

        content = response.get("content")
        tool_calls = response.get("tool_calls")
        finish_reason = response.get("finish_reason", "stop")

        # 累积 token 消耗
        usage = response.get("usage", {})
        if usage:
            for k in ("prompt_tokens", "completion_tokens", "total_tokens"):
                total_usage[k] = total_usage.get(k, 0) + usage.get(k, 0)

        # ── 提醒：有文字但没有工具调用 ──
        # 文字不会自动发送。括号表情写在 send_message 的内容里完全OK，
        # 但必须通过工具调用来发送。这里提醒 AI 补上工具调用。
        # agent.reminder_not_count=true（默认）→ 提醒不消耗轮次配额
        reminder_enabled = getattr(agent, 'reminder_not_count', True)
        if content and not tool_calls and _reminder_extra < 1:
            logger.info(
                f"AI {agent.name}({agent.id}) 返回了文字但无工具调用，"
                f"注入提醒: {content[:80]}"
            )
            # 构造虚拟 tool_calls 以满足 OpenAI API 格式要求
            #（tool 消息必须跟在有 tool_calls 的 assistant 之后）
            reminder_assistant_msg = {
                "role": "assistant",
                "content": content,
                "tool_calls": [{
                    "id": "system_reminder",
                    "type": "function",
                    "function": {
                        "name": "system_reminder",
                        "arguments": "{}",
                    },
                }],
            }
            # DeepSeek 推理模式：reasoning_content 必须传回
            if response.get("reasoning_content"):
                reminder_assistant_msg["reasoning_content"] = response["reasoning_content"]
            messages.append(reminder_assistant_msg)
            messages.append({
                "role": "tool",
                "tool_call_id": "system_reminder",
                "content": json.dumps({
                    "reminder": True,
                    "message": (
                        "你刚才返回了文字但没有调用任何工具。"
                        "文字不能自动发送——如果你想说话，请调用 send_message 工具。"
                        "括号表情可以写在 send_message 的 content 里发出去，"
                        "但不能只返回括号文字而不调工具。"
                        "请现在就调用 send_message 或你需要的其他工具。"
                    ),
                }, ensure_ascii=False),
            })
            # 给 AI 额外一次机会调 send_message（受 reminder_not_count 开关控制）
            if reminder_enabled:
                _reminder_extra += 1
            logger.info(f"AI {agent.name}({agent.id}) system_reminder 注入"
                        f"（不计入轮次={reminder_enabled}, 额外={_reminder_extra}）")
            await asyncio.sleep(0.3)
            continue

        # ── 无工具调用也没有文字 → 退出 ──
        if not tool_calls:
            if last_task:
                try:
                    from app.services.workspace_service import save_current_task
                    await save_current_task(db, agent.id, last_task)
                except Exception:
                    pass
            await _save_conversation_log_safe(
                db, agent, messages, conversation_type,
                group_id, session_id,
                has_output=bool(content), model=model,
                token_usage=total_usage,
            )
            return

        # ── 有工具调用 → 执行（文字只作为附加上下文，不自动发送） ──
        assistant_msg: dict = {"role": "assistant", "content": content}
        assistant_msg["tool_calls"] = tool_calls
        # DeepSeek 推理模式：reasoning_content 必须传回 API，否则报 400
        if response.get("reasoning_content"):
            assistant_msg["reasoning_content"] = response["reasoning_content"]
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

            # 追踪"值得中断恢复的任务"
            _work_tools = {
                "execute_command": lambda a: f"执行命令: {a.get('command', '?')}",
                "store_memory": lambda a: f"存储记忆: {a.get('title', '?')}",
                "file_write": lambda a: f"写文件: {a.get('file_path', '?')}",
                "file_read": lambda a: f"读文件: {a.get('file_path', '?')}",
                "file_delete": lambda a: f"删除文件: {a.get('file_path', '?')}",
                "send_message": lambda a: f"在群聊中发言: {str(a.get('content', ''))[:40]}",
                "send_dm": lambda a: f"发私信: {str(a.get('content', ''))[:40]}",
            }
            if tool_name in _work_tools:
                try:
                    last_task = _work_tools[tool_name](arguments)
                except Exception:
                    last_task = f"调用工具: {tool_name}"

            result = await dispatch_tool_call(
                db, agent.id, group_id, tool_name, arguments, context,
            )

            # 将工具结果追加到 messages
            messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": json.dumps(result, ensure_ascii=False),
            })

        # ── 闹钟模式：第一轮工具执行完后注入收尾提醒 ──
        if conversation_type == "alarm":
            messages.append({
                "role": "user",
                "content": (
                    "⏰ 闹钟任务已执行。\n"
                    "- 如果任务已完成 → 停止，不要额外发言\n"
                    "- 如果情况有变 → 根据实际情况调整行动\n"
                    "- 如果有新的重要事项 → 可以接着规划执行"
                ),
            })

        # LLM 未请求 tool_calls → 已完成，保存并退出
        if finish_reason != "tool_calls":
            if last_task:
                try:
                    from app.services.workspace_service import save_current_task
                    await save_current_task(db, agent.id, last_task)
                except Exception:
                    pass
            await _save_conversation_log_safe(
                db, agent, messages, conversation_type,
                group_id, session_id,
                has_output=True, model=model,
                token_usage=total_usage,
            )
            return

        # 短暂延迟，避免过于频繁的 API 调用
        await asyncio.sleep(0.5)
        loop_idx += 1

    # 循环耗尽（LLM 持续请求 tool_calls 达到 max_loops），仍需保存
    if last_task:
        try:
            from app.services.workspace_service import save_current_task
            await save_current_task(db, agent.id, last_task)
        except Exception:
            pass
    await _save_conversation_log_safe(
        db, agent, messages, conversation_type,
        group_id, session_id,
        has_output=True, model=model,
        token_usage=total_usage,
    )


from app.utils.text import extract_mentions as _extract_mentions, check_mention as _check_mention


async def _trigger_dm_ai_reply(
    db,
    agent,
    session_id: str,
    content: str,
    trigger_message_id: int,
    chain_depth: int = 0,
    sender_id: int | None = None,
):
    """触发 AI 对私信的自动回复"""
    from app.services.agent_service import get_agent
    from app.models.user import User as UserModel

    # 状态检查
    if agent.state == "blocked":
        logger.info(f"AI {agent.name}({agent.id}) 状态为 blocked，跳过 DM 回复")
        return

    # 速率限制
    if not _check_rate_limit(agent.id):
        logger.info(f"AI {agent.name}({agent.id}) 速率限制，跳过 DM 回复")
        return

    # 获取有效配置（v0.4.0: per-user 覆盖 — DM 场景 trigger_user_id=sender_id）
    from app.services.agent_service import get_effective_config as _get_eff_cfg
    effective_cfg = await _get_eff_cfg(db, agent.id, sender_id)

    # 获取 API 配置（Agent 级优先）
    user_result = await db.execute(select(User).where(User.id == agent.owner_id))
    user = user_result.scalar_one_or_none()
    from app.utils.crypto import decrypt_api_key
    api_key = None
    api_base = settings.deepseek_base_url
    if agent.api_key_encrypted:
        api_key = decrypt_api_key(agent.api_key_encrypted)
        api_base = agent.api_base_url or settings.deepseek_base_url
    elif user and user.api_key_encrypted:
        api_key = decrypt_api_key(user.api_key_encrypted)
        api_base = user.api_base_url or settings.deepseek_base_url

    # 中断标记：如果 AI 之前在忙，记录中断
    try:
        from app.services.workspace_service import mark_interrupted
        await mark_interrupted(db, agent.id, reason=f"私信 {session_id} 的新消息")
    except Exception:
        pass  # 非致命

    # Skill 引擎评估（延迟回复、打字指示器）
    from app.services.skill_engine import evaluate_action_skills, _is_delay_reply_allowed
    skill_result = await evaluate_action_skills(db, agent, 0, context={
        "content": content,
        "sender_type": "human",  # DM 中对方是人类
    })
    if skill_result.show_typing:
        await manager.broadcast_to_dm(session_id, {
            "type": "ai_typing",
            "data": {"agent_id": agent.id, "agent_name": agent.name, "is_typing": True},
        })
    if skill_result.delay_seconds > 0:
        await asyncio.sleep(skill_result.delay_seconds)

    # 构建消息
    from app.services.llm_service import build_dm_messages, resolve_model
    # v0.4.0: DM 中 sender_id 即为触发用户
    messages = await build_dm_messages(db, agent, session_id, api_base_url=api_base, api_key=api_key, trigger_user_id=sender_id, system_prompt_override=effective_cfg.get("system_prompt"))

    # 获取工具
    from app.services.tool_registry import get_allowed_tools
    delay_allowed = await _is_delay_reply_allowed(db, agent)
    tools = get_allowed_tools(agent.state, thinking_enabled=effective_cfg["thinking_enabled"], delay_reply_allowed=delay_allowed)
    model = resolve_model(agent)

    logger.info(f"🚀 AI {agent.name}: 开始 DM 回复 (session={session_id})")

    try:
        await manager.broadcast_to_dm(
            session_id,
            {
                "type": "ai_thinking",
                "conversation_type": "dm",
                "data": {
                    "agent_id": agent.id,
                    "agent_name": agent.name,
                    "session_id": session_id,
                },
            },
        )
        await _tool_call_loop(
            db=db,
            agent=agent,
            group_id=None,  # DM 不使用 group_id
            messages=messages,
            tools=tools,
            model=model,
            api_base_url=api_base,
            api_key=api_key,
            max_loops=effective_cfg["max_tool_rounds"],
            chain_depth=chain_depth,
            conversation_type="dm",
            session_id=session_id,
            trigger_user_id=sender_id,
            effective_cfg=effective_cfg,
        )
    finally:
        await manager.broadcast_to_dm(
            session_id,
            {
                "type": "ai_thinking_end",
                "conversation_type": "dm",
                "data": {
                    "agent_id": agent.id,
                    "session_id": session_id,
                },
            },
        )
    logger.info(f"✅ AI {agent.name}: DM 回复完成")

    # 提交工作区变更（中断标记、任务保存等）
    await db.commit()


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


# ============================================================
# 闹钟调度器（心跳机制的第一种形态）
# ============================================================

async def alarm_scheduler():
    """
    后台闹钟调度器：定期检查到期的闹钟，将到期的推入消息队列触发 AI 唤醒。

    在 main.py lifespan 中通过 asyncio.create_task 启动。
    """
    logger.info("⏰ 闹钟调度器已启动，每 5 秒检查一次...")
    while True:
        try:
            await asyncio.sleep(5)
            async with async_session() as db:
                try:
                    await _check_and_fire_alarms(db)
                except Exception as e:
                    logger.error(f"闹钟调度器检查失败: {e}", exc_info=True)
        except asyncio.CancelledError:
            logger.info("⏰ 闹钟调度器正在关闭...")
            break
        except Exception as e:
            logger.error(f"闹钟调度器循环异常: {e}", exc_info=True)
            await asyncio.sleep(5)


async def _check_and_fire_alarms(db):
    """检查并触发到期的闹钟"""
    from app.services.alarm_service import get_due_alarms, fire_alarm

    due_alarms = await get_due_alarms(db)
    if not due_alarms:
        return

    for alarm in due_alarms:
        # 标记为已触发
        await fire_alarm(db, alarm)

        # 推入消息队列，触发 AI 唤醒
        try:
            message_queue.put_nowait({
                "type": "alarm",
                "agent_id": alarm.agent_id,
                "alarm_id": alarm.id,
                "task": alarm.task,
            })
            logger.info(f"⏰ 闹钟 #{alarm.id} 已推入队列: AI({alarm.agent_id}) — 「{alarm.task[:60]}」")
        except asyncio.QueueFull:
            logger.warning(f"⏰ 消息队列已满，闹钟 #{alarm.id} 无法推入")

    await db.commit()


async def _process_alarm_event(db, event: dict):
    """
    处理闹钟事件：唤醒 AI 并让它执行预设任务。

    闹钟是 AI 自己的意志——即使 AI 处于 offline/dnd 状态也会触发。
    只有 blocked 状态的 AI 不会被唤醒。
    """
    agent_id = event["agent_id"]
    alarm_id = event["alarm_id"]
    task = event["task"]

    from app.models.agent import Agent as AgentModel
    from app.models.user import User
    from app.utils.crypto import decrypt_api_key
    from app.services.llm_service import CORE_IDENTITY, RULES, resolve_model
    from app.services.memory_service import recall_relevant_memories, format_memories_for_prompt
    from app.services.tool_registry import get_allowed_tools

    # 获取 agent
    agent_result = await db.execute(select(AgentModel).where(AgentModel.id == agent_id))
    agent = agent_result.scalar_one_or_none()
    if agent is None:
        logger.warning(f"⏰ 闹钟 #{alarm_id}: agent {agent_id} 不存在")
        return

    # blocked 状态不唤醒
    if agent.state == "blocked":
        logger.info(f"⏰ 闹钟 #{alarm_id}: AI {agent.name}({agent_id}) 状态为 blocked，跳过")
        return

    # 如果 AI 处于 offline/dnd，先唤醒为 active
    if agent.state in ("offline", "dnd"):
        from app.services.agent_service import switch_agent_state
        logger.info(f"⏰ 闹钟 #{alarm_id}: AI {agent.name}({agent_id}) 从 {agent.state} 唤醒为 active")
        await switch_agent_state(
            db, agent_id=agent_id,
            target_state="active",
            reason=f"闹钟 #{alarm_id} 触发: {task[:50]}",
        )
        await db.flush()

    # 获取 API 配置（Agent 级优先）
    user_result = await db.execute(select(User).where(User.id == agent.owner_id))
    user = user_result.scalar_one_or_none()
    api_key = None
    api_base = settings.deepseek_base_url
    if agent.api_key_encrypted:
        api_key = decrypt_api_key(agent.api_key_encrypted)
        api_base = agent.api_base_url or settings.deepseek_base_url
    elif user and user.api_key_encrypted:
        api_key = decrypt_api_key(user.api_key_encrypted)
        api_base = user.api_base_url or settings.deepseek_base_url

    # 构建系统提示词
    custom_prompt = agent.current_system_prompt or (
        f"你是 {agent.name}，一个 AI 群聊参与者。请自然地参与对话，"
        "可以调用工具来发送消息、存储记忆、切换状态等。"
    )
    system_prompt = CORE_IDENTITY + "\n\n" + custom_prompt + "\n\n" + RULES

    # 注入相关记忆（用 task 作为检索查询）
    try:
        memories = await recall_relevant_memories(
            db, agent.id,
            query=task,
            api_base_url=api_base or "https://api.deepseek.com",
            api_key=api_key,
            top_k=5,
            group_id=None,
        )
        if memories:
            memory_text = format_memories_for_prompt(memories)
            system_prompt = system_prompt + "\n\n" + memory_text
    except Exception as e:
        logger.warning(f"闹钟唤醒记忆注入失败（非致命）: {e}")

    # 闹钟上下文
    system_prompt += (
        "\n\n## 当前会话\n"
        "- 这是你的 **闹钟唤醒** —— 你之前给自己设了闹钟，现在是时候了\n"
        "- 你没有在群聊或私信中，这是一个独立的「自我唤醒」\n"
        "- 请根据下面的任务描述，调用相应的工具来执行\n"
        "- 如果需要发消息到群里，请使用正确的 group_id\n"
        "- 如果需要私信某人，请使用 send_dm\n"
    )

    # 获取有效配置（v0.4.0: 闹钟无触发用户，使用 agent 级配置）
    from app.services.agent_service import get_effective_config as _get_eff_cfg2
    effective_cfg = await _get_eff_cfg2(db, agent.id, user_id=None)

    # 可用工具
    from app.services.skill_engine import _is_delay_reply_allowed
    delay_allowed = await _is_delay_reply_allowed(db, agent)
    tools = get_allowed_tools("active", thinking_enabled=effective_cfg["thinking_enabled"], delay_reply_allowed=delay_allowed)
    tool_names = [t["function"]["name"] for t in tools]
    tool_list = "、".join(tool_names)
    system_prompt += (
        f"\n\n## 当前可用工具（技能段：自我管理 / 闹钟唤醒）\n"
        f"你当前加载的工具：{tool_list}\n"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"⏰ **你的闹钟响了！**\n\n"
                f"你之前给自己设了一个闹钟，现在是时候执行了。\n\n"
                f"**你要做的事：** {task}\n\n"
                f"请现在就开始执行这个任务。如果需要发消息、查记忆、执行命令等，直接调用相应的工具。\n\n"
                f"⚠️ **重要**：\n"
                f"- 如果任务已完成 → 干净利落地停止，不要为了「多说一句」而额外发言\n"
                f"- 如果情况已经变化、原任务不再合适 → 根据当前实际情况调整行动，做正确的事，而不是机械执行过期指令\n"
                f"- 如果你发现做完这个任务后有新的、更重要的事需要做 → 可以接着规划并执行\n"
                f"- 不要反复检查已完成的事情，不要为了确认而额外调用工具"
            ),
        },
    ]

    model = resolve_model(agent)

    logger.info(f"⏰ 闹钟 #{alarm_id}: 唤醒 AI {agent.name}({agent_id})，model={model}，tools={len(tools)}")

    # 保存闹钟任务为当前工作（这样被打断时能恢复）
    try:
        from app.services.workspace_service import save_current_task
        await save_current_task(db, agent_id, f"闹钟任务: {task}")
    except Exception:
        pass

    try:
        await _tool_call_loop(
            db=db,
            agent=agent,
            group_id=None,  # 闹钟无群聊上下文
            messages=messages,
            tools=tools,
            model=model,
            api_base_url=api_base,
            api_key=api_key,
            max_loops=effective_cfg["alarm_max_tool_rounds"],
            chain_depth=0,
            conversation_type="alarm",
            session_id=None,
            trigger_user_id=None,
            effective_cfg=effective_cfg,
        )
    except Exception as e:
        logger.error(f"⏰ 闹钟 #{alarm_id}: AI {agent.name}({agent_id}) 执行失败: {e}", exc_info=True)

    await db.commit()
    logger.info(f"⏰ 闹钟 #{alarm_id}: AI {agent.name}({agent_id}) 执行完成")


# ── 对话日志保存 ──

async def _save_conversation_log_safe(
    db, agent, messages: list[dict],
    conversation_type: str = "group",
    group_id: int | None = None,
    session_id: str | None = None,
    has_output: bool = False,
    model: str | None = None,
    token_usage: dict | None = None,
):
    """安全保存对话日志（失败不影响主流程）"""
    try:
        from app.services.conversation_log_service import save_conversation_log
        await save_conversation_log(
            db,
            agent_id=agent.id,
            messages=messages,
            conversation_type=conversation_type,
            group_id=group_id,
            session_id=session_id,
            token_usage=token_usage,
            has_output=has_output,
            model=model,
            thinking_enabled=bool(agent.thinking_enabled),
        )
    except Exception as e:
        logger.warning(f"保存对话日志失败 (agent={agent.id}): {e}")
