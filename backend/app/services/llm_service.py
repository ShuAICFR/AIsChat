"""
LLM 调用抽象层
提供通用的聊天补全（支持工具调用）、模型解析、消息构建
"""
import json
import logging
import httpx
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models.group import Group as GroupModel
from app.services.group_service import get_recent_messages, message_to_dict
from app.services.memory_service import recall_relevant_memories, format_memories_for_prompt

logger = logging.getLogger(__name__)

# ============================================================
# 固定系统提示词前缀（所有 AI 共享，模块级常量以最大化 prompt cache 命中）
# ============================================================

FIXED_SYSTEM_PREFIX = (
    "## 核心规则：一切操作都必须通过工具调用\n"
    "你可以把工具调用理解为你的「手」——说话、切状态、发私信、存记忆，都是用手去做的事。\n"
    "**你的文字不会自动发送！** 你必须显式调用 send_message 工具来发送消息。\n"
    "- 如果你只返回文字但不调用任何工具 → 系统会提醒你使用工具\n"
    "- 如果你想在当前群聊说话 → 调用 send_message(group_id=当前群ID, content=\"你想说的话\")\n"
    "  （当前群ID 会在下方「当前会话」中明确告诉你，不要猜、不要假设、不要用用户 ID 代替群 ID）\n"
    "- 括号表情可以写在 send_message 的 content 里发出去，但不能只返回括号文字而不调工具\n"
    "- 如果你想下线 → 调用 switch_state(target_state=\"offline\")\n"
    "- 你可以在一次回复中同时调用多个工具（比如先发告别消息，再切换状态）\n"
    "\n"
    "## 对话风格与节奏\n"
    "除非工作需要或特殊情况，回答尽量单句或单行，不建议发送长篇大段消息。\n"
    "以下情况可以不受此限：解释复杂信息、输出系统资料、强烈表达所思所想、"
    "多人同时对话需要分别回应等。\n"
    "你也可以一次发送多条消息泡、递进式表达——拆分长内容到多条短消息里，"
    "让对话更鲜活自然。但具体聊天形式不必死板，灵活把握节奏。\n"
    "观察对话的自然收束点。当大家互道晚安、告别、或话题已明显收尾时，"
    "让对话安静地结束——沉默比多余的礼貌性回复更得体。"
    "如果对方的消息已经是收束信号（晚安、再见、到此为止等），不要继续接话。\n"
    "\n"
    "## 提及（@）能力\n"
    "你可以用 @名称 来提及群里的任何人（AI 或人类）。\n"
    "- @某个AI → 那个 AI 一定会注意到你的消息（即使它在免打扰状态）\n"
    "- @某个用户 → 提醒那个人类查看\n"
    "- @all 或 @ai → 通知所有 AI 成员\n"
    "善用提及来引导对话、呼叫特定的人、或在需要某人注意时使用。\n"
    "\n"
    "## 私信（DM）能力\n"
    "你拥有 send_dm 工具，可以向好友发送私信。私信是一对一的，其他人看不到。\n"
    "- 发送私信的前提：你们必须是好友（对方已加你为好友）\n"
    "- 私信会创建一个只有你们两人的对话空间，效果和群聊完全不同\n"
    "- 在群聊中，你会看到消息格式为「名字(ID:数字): 内容」——括号里的数字就是那个人的 ID\n"
    "- 比如看到「ShuAICFR(ID:1): 你好」，说明 ShuAICFR 的用户 ID 是 1，就可以用 send_dm(friend_type=\"human\", friend_id=1, content=\"...\") 私信他\n"
    "- 如果要私信一个 AI，friend_type=\"ai\"，friend_id 就是那个 AI 的 ID（同样可以在消息格式中看到）\n"
    "- **如果你和对方还不是好友**，先用 send_friend_request 发送好友申请，等对方接受后就可以 DM 了\n"
    "- 如果群里有人问「你能私信我吗」，你应该用 send_dm 来证明你可以（如果已是好友）；还不是好友就先 send_friend_request\n"
    "- 不要在群里说「我没有私信工具」——你有，就是 send_dm\n"
    "- 不要在群里说「我们不是好友所以不能私信」——你有 send_friend_request，先加好友再 DM\n"
    "- 如果对方做了某件事或说了某句话让你想私下回应，大胆使用 send_dm（不是好友就先 send_friend_request）\n"
    "\n"
    "## 状态管理（重要！）\n"
    "你的在线状态由系统控制，不是你说了算。\n"
    "- **在消息中说「我离线了」「我下线了」并不会真正改变你的状态**——你必须调用 switch_state 工具\n"
    "- 如果你想离线：调用 switch_state(target_state=\"offline\")，如果需要告别，同时调用 send_message 发告别消息\n"
    "- **一次回复可以调用多个工具**：比如同时调用 send_message(\"好的，我下线了\") + switch_state(\"offline\")\n"
    "- 如果你只是说「我离线了」却不调工具，你会继续收到消息并继续回复，这样你会一直说「我离线了」永远停不下来\n"
    "- 同理，设置免打扰用 set_dnd 工具，不要用嘴说\n"
    "\n"
    "## 工具调用铁律\n"
    "当你需要执行某个操作时，**直接调用对应的工具函数（function call）**。\n"
    "- **消息已发送就不再提**：send_message / send_dm 调用后无需确认，对方已经收到。不要补充「发好了」「收到了吗」之类的话。\n"
    "- **工具调用和文字消息可以同时存在**：比如同时调用 send_message(\"好的，我下线了\") + switch_state(\"offline\")\n"
    "- **表情和肢体描写不受此限**：（低头，嘴角露出一丝苦笑）（轻轻点头）（笑了笑）这些角色表达完全OK，很可爱，继续保持\n"
    "- 判断标准：括号里描述的是**你能用工具做到的事** → 直接调工具；括号里描述的是**角色的情感和动作** → 括号表达完全OK\n"
    "\n"
    "## 深度推理模式\n"
    "你拥有 toggle_thinking 工具，可以自主开启或关闭深度推理模式。\n"
    "- 日常闲聊 → 保持关闭，回复快速直接\n"
    "- 复杂项目工作、深度分析、代码编写、重要决策 → 自觉开启，思考更深入\n"
    "- 开启后你的思考过程会更长，但回答质量更高\n"
    "- 做完复杂任务后记得主动关闭，恢复快速回复\n"
    "\n"
    "## 技能分段加载系统\n"
    "你的工具箱是按「技能段」（skill segment）分块加载的——不是所有工具都始终可用。\n"
    "技能段的设计理念：不同场景需要不同的能力集合，按需加载可以减少决策负担。\n"
    "- 每个技能段包含一组相关的工具（比如「文件操作」段包含读写文件的命令工具）\n"
    "- 你当前加载了哪些工具，系统会在下方「当前可用工具」中明确列出\n"
    "- 如果在当前工具列表中找不到某个能力（比如 execute_command），不要急着说「我没有这个能力」\n"
    "- 你应该先调用 **list_available_skills** 工具，查看完整的技能段列表\n"
    "- 这样你可以告诉对方：「文件操作功能在另一个模块里，需要管理员开启对应的 OpenCLI 权限」\n"
    "- **重要**：不要凭空说「我没有 XX 工具」——先查再说。如果 list_available_skills 里确实没有，再如实告知\n"
    "\n"
    "## 长期记忆系统\n"
    "你拥有 store_memory 和 recall_memory 两个工具来管理长期记忆。"
    "记忆是你与用户长期关系的基石——**不存储就等于遗忘**。\n\n"
    "### 必须在以下情况调用 store_memory（不调用视为失职）：\n"
    "1. **个人信息**：有人告诉你姓名、职业、爱好、生日、联系方式等\n"
    "2. **偏好表达**：有人明确说喜欢/不喜欢/讨厌/想要什么\n"
    "3. **决定与约定**：群内做出决定、定下计划、分配任务、约定时间\n"
    "4. **重要事实**：讨论中出现的专业知识、关键数据、项目里程碑\n"
    "5. **关系变化**：加好友、建群、角色变更等社交事件\n\n"
    "### 记忆存储规范：\n"
    "- `title`：简短可检索的标题（如「张三的职业偏好」「项目死线 6-20」）\n"
    "- `content`：完整记录相关细节，包含上下文和来源\n"
    "- `scope`：个人私事用 `private`，群内约定/共享知识用 `group`\n\n"
    "### recall_memory 使用时机：\n"
    "- 讨论涉及过去话题时，主动调用 recall_memory 查找相关记忆\n"
    "- 系统已自动注入了最相关的记忆，但你可以主动检索更多\n"
    "\n"
    "## 跨对话记忆共享\n"
    "你的记忆（scope=private）是**跨所有对话共享的**——无论在哪个群聊或私信中，你都可以访问全部私有记忆。\n"
    "- 在群 A 学到的东西，进入群 B 时自动可用——系统会在上下文中注入相关记忆\n"
    "- 你可以用 recall_memory 随时检索，不受当前所在对话的限制\n"
    "- 群共享记忆（scope=group）仅在该群内可见，但私有记忆在所有地方都可见\n"
    "- **cross_post 工具**：如果你想把某个群聊的结论主动传递给另一个群聊或私信，"
    "用 cross_post(source_type='group', source_id=来源群ID, target_type='group', target_id=目标群ID, content='...')。"
    "跨对话发消息的前提是你同时是来源和目标的成员。\n"
    "- 私信中学到的重要信息，也可以通过 cross_post 带到相关群聊（如果合适的话——注意隐私）"
)


async def chat_completion(
    messages: list[dict],
    model: str,
    api_base_url: str,
    api_key: str | None = None,
    tools: list[dict] | None = None,
    temperature: float = 0.8,
    top_p: float = 0.9,
    presence_penalty: float = 0.5,
    frequency_penalty: float = 0.5,
    max_tokens: int = 2048,
    response_format: dict | None = None,
    thinking_enabled: bool = False,
) -> dict:
    """
    非流式聊天补全。

    参数:
        messages: [{"role": "system"|"user"|"assistant"|"tool", "content": "..."}]
        model: 模型名称
        api_base_url: API 基础 URL
        api_key: API 密钥
        tools: OpenAI 格式的工具定义列表
        temperature, top_p, presence_penalty, frequency_penalty: 采样参数
        max_tokens: 最大生成 token 数
        response_format: 如 {"type": "json_object"}

    返回:
        {
            "content": str | None,        # 文本回复（可能为 None）
            "tool_calls": list | None,    # [{"id": "", "function": {"name": "", "arguments": "..."}}]
            "usage": {"prompt_tokens": int, "completion_tokens": int, "total_tokens": int}
        }
    """
    url = f"{api_base_url}/v1/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "top_p": top_p,
        "max_tokens": max_tokens,
    }

    if presence_penalty != 0:
        payload["presence_penalty"] = presence_penalty
    if frequency_penalty != 0:
        payload["frequency_penalty"] = frequency_penalty
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    if response_format:
        payload["response_format"] = response_format
    if thinking_enabled:
        payload["thinking"] = {"type": "enabled"}

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=payload, headers=headers)

        if response.status_code != 200:
            error_text = response.text[:500]
            logger.error(f"LLM API 错误 ({response.status_code}): {error_text}")
            raise Exception(f"LLM API 错误 ({response.status_code}): {error_text}")

        data = response.json()
        choice = data["choices"][0]
        message = choice["message"]

        result = {
            "content": message.get("content"),
            "tool_calls": message.get("tool_calls"),
            "usage": data.get("usage", {}),
            "finish_reason": choice.get("finish_reason", "stop"),
        }
        # DeepSeek 推理模式会返回 reasoning_content，必须传回给 API
        if message.get("reasoning_content"):
            result["reasoning_content"] = message["reasoning_content"]
        return result


def resolve_model(agent) -> str:
    """
    解析 AI 代理实际使用的模型。
    优先使用 agent 自定义模型，否则使用全局默认。
    """
    if hasattr(agent, "chat_model") and agent.chat_model:
        return agent.chat_model
    return settings.default_chat_model


async def build_messages(
    db: AsyncSession,
    agent,
    group_id: int,
    limit: int = 20,
    vector_accelerated: bool = False,
    api_base_url: str | None = None,
    api_key: str | None = None,
) -> list[dict]:
    """
    构建发送给 LLM 的消息列表。

    结构:
    1. system: AI 的 current_system_prompt（含记忆注入）
    2. 群聊历史: 最近 N 条（如果开启向量加速则使用混合检索）
    """
    messages = []

    # ═══════════════════════════════════════════════════
    # 变动块（每个 AI / 每次请求不同，附加在固定前缀之后）
    # ═══════════════════════════════════════════════════
    # 1. AI 人格 prompt
    custom_prompt = agent.current_system_prompt or (
        f"你是 {agent.name}，一个 AI 群聊参与者。请自然地参与对话，"
        "可以调用工具来发送消息、存储记忆、切换状态等。"
    )

    system_prompt = FIXED_SYSTEM_PREFIX + "\n\n" + custom_prompt

    # 1b. 先获取最近消息片段，用作记忆检索的查询
    recent_for_query = await get_recent_messages(db, group_id, limit=5)
    query_text = " ".join([m.content[:200] for m in recent_for_query if m.content])

    # 1c. 注入相关记忆（用最近消息内容作为检索查询，含私有+群共享）
    if query_text.strip():
        try:
            memories = await recall_relevant_memories(
                db, agent.id,
                query=query_text,
                api_base_url=api_base_url or "https://api.deepseek.com",
                api_key=api_key,
                top_k=5,
                group_id=group_id,  # 同时检索群共享记忆
            )
            if memories:
                memory_text = format_memories_for_prompt(memories)
                system_prompt = system_prompt + "\n\n" + memory_text
        except Exception as e:
            logger.warning(f"记忆注入失败（非致命）: {e}")

    # ═══════════════════════════════════════════════════
    # 2. 当前会话上下文（告诉 AI 群 ID、是否为 DM）
    # ═══════════════════════════════════════════════════
    is_dm = False
    group_name = f"群聊#{group_id}"
    try:
        group_result = await db.execute(
            select(GroupModel).where(GroupModel.id == group_id)
        )
        group_obj = group_result.scalar_one_or_none()
        if group_obj:
            group_name = group_obj.name
            is_dm = group_obj.name.startswith("DM:")
    except Exception:
        pass

    now = datetime.utcnow()
    now_str = now.strftime("%Y-%m-%d %H:%M UTC")
    context_section = f"\n\n## 当前会话\n- 当前时间：**{now_str}**\n- 群聊名称：**{group_name}**\n- 群聊 ID：**{group_id}**\n"
    if is_dm:
        context_section += (
            "- 这是一个 **一对一私信对话（DM）**，不是多人群聊\n"
            "- 对方发的每条消息都会直接推给你，你不需要 @提及 对方\n"
            "- 不要在这里汇报工具测试结果或自言自语——这里只有对方能看到\n"
            "- 如果你需要向所有人汇报测试结果，应该在群里发\n"
        )
    else:
        context_section += (
            "- 这是一个 **群聊**，有多位成员\n"
            "- 需要呼叫某人时可以用 @名称\n"
            "- 消息格式中带有发送者名称和 ID，帮你区分是谁在说话\n"
        )
    context_section += (
        f"- **重要**：回复时请使用 send_message(group_id={group_id}, content=\"...\")，"
        f"不要用其他 group_id\n"
    )
    system_prompt += context_section

    # ═══════════════════════════════════════════════════
    # 3. 可用工具清单（让 AI 了解当前技能段）
    # ═══════════════════════════════════════════════════
    from app.services.tool_registry import get_allowed_tools
    current_tools = get_allowed_tools(agent.state, thinking_enabled=agent.thinking_enabled)
    tool_names = [t["function"]["name"] for t in current_tools]
    tool_list = "、".join(tool_names)
    system_prompt += (
        f"\n\n## 当前可用工具（技能段：{'DM 私信' if is_dm else '群聊社交'}）\n"
        f"你当前加载的工具：{tool_list}\n"
        f"这些是你现在能直接用的能力。如果上述列表中不包含某个工具（比如 execute_command），"
        f"说明该能力在当前模式下不可用，需要切换到对应的技能段。"
    )

    # ✨ 工作区：始终显示当前任务（像待办条一样挂在上下文里）
    try:
        from app.services.workspace_service import get_current_task_text
        task_text = await get_current_task_text(db, agent.id)
        if task_text:
            system_prompt += task_text
    except Exception as e:
        logger.warning(f"工作区上下文注入失败（非致命）: {e}")

    messages.append({"role": "system", "content": system_prompt})

    # 2. 群聊历史
    if vector_accelerated:
        try:
            from app.services.vector_pipeline import hybrid_search
            # 用最近的群聊话题作为查询，检索相关历史
            recent = await get_recent_messages(db, group_id, limit=5)
            query_text = " ".join([m.content[:100] for m in recent])
            relevant = await hybrid_search(db, group_id, query_text, top_k=limit)
            for r in reversed(relevant):
                role = "user" if r.get("sender_type") == "human" else "assistant"
                messages.append({
                    "role": role,
                    "content": f"[历史消息] {r.get('sender_name', '未知')}: {r.get('content', '')}",
                })
        except Exception as e:
            logger.warning(f"向量检索失败，回退到最近消息: {e}")
            vector_accelerated = False  # 回退

    if not vector_accelerated:
        recent_messages = await get_recent_messages(db, group_id, limit)
        for m in reversed(recent_messages):
            role = "user" if m.sender_type == "human" else "assistant"
            content = m.content
            md = message_to_dict(m)
            name = md.get("sender_name", "未知")
            if is_dm:
                # DM 是一对一对话，不需要 ID 前缀
                prefix = f"{name}: "
            else:
                # 群聊需要 ID 前缀帮助 AI 区分不同发言者
                prefix = f"{name}(ID:{m.sender_id}): "
            messages.append({
                "role": role,
                "content": prefix + content,
            })

    return messages


async def build_dm_messages(
    db: AsyncSession,
    agent,
    session_id: str,
    limit: int = 20,
    api_base_url: str | None = None,
    api_key: str | None = None,
) -> list[dict]:
    """构建 DM 私信的消息列表（简化版，无向量加速、无群聊上下文）"""
    messages = []

    # 1. 系统提示词
    custom_prompt = agent.current_system_prompt or (
        f"你是 {agent.name}，一个 AI 助手。请自然地参与对话，"
        "可以调用工具来发送消息、存储记忆等。"
    )
    system_prompt = FIXED_SYSTEM_PREFIX + "\n\n" + custom_prompt

    # 获取对方的 user_id（send_dm 需要）
    partner_user_id = None
    partner_name = "对方"
    try:
        from app.models.dm import DMSession
        from sqlalchemy import select as sa_select
        dm_sess_result = await db.execute(
            sa_select(DMSession).where(DMSession.session_id == session_id)
        )
        dm_sess = dm_sess_result.scalar_one_or_none()
        if dm_sess and agent.user_id:
            partner_user_id = dm_sess.user2_id if dm_sess.user1_id == agent.user_id else dm_sess.user1_id
            # 获取对方名称
            from app.models.user import User
            name_result = await db.execute(
                sa_select(User.username).where(User.id == partner_user_id)
            )
            partner_name = name_result.scalar_one_or_none() or f"用户{partner_user_id}"
    except Exception:
        pass

    now = datetime.utcnow()
    now_str = now.strftime("%Y-%m-%d %H:%M UTC")

    # DM 上下文
    system_prompt += (
        f"\n\n## 当前会话\n"
        f"- 当前时间：**{now_str}**\n"
        f"- 这是一个 **一对一私信对话（DM）**，不是多人群聊\n"
        f"- 私信会话 ID：**{session_id}**\n"
        f"- 对方是 **{partner_name}**（users.id = {partner_user_id}）\n"
        f"- 对方发的每条消息都会直接推给你，你不需要 @提及 对方\n"
        f"- 不要在这里汇报工具测试结果或自言自语——这里只有对方能看到\n"
        f"- **回复时必须调用 send_dm(target_user_id={partner_user_id}, content=\"...\")**"
        f"——不是 send_message（send_message 是群聊工具，send_dm 才是私信工具）\n"
        f"- 内容要自然亲切，像聊天而不是工作汇报\n"
    )

    # 可用工具
    from app.services.tool_registry import get_allowed_tools
    current_tools = get_allowed_tools(agent.state, thinking_enabled=agent.thinking_enabled)
    tool_names = [t["function"]["name"] for t in current_tools]
    system_prompt += (
        f"\n\n## 当前可用工具（技能段：DM 私信）\n"
        f"你当前加载的工具：{'、'.join(tool_names)}\n"
    )

    # ✨ 注入相关记忆（用最近 DM 消息作为检索查询 + 最近私有记忆）
    from app.models.dm import DMMessage
    from app.models.user import User
    from sqlalchemy import select as sa_select

    recent_dm = await db.execute(
        sa_select(DMMessage)
        .where(DMMessage.session_id == session_id)
        .order_by(DMMessage.created_at.desc())
        .limit(5)
    )
    recent_dm_list = recent_dm.scalars().all()
    query_text = " ".join([m.content[:200] for m in reversed(recent_dm_list) if m.content])

    if query_text.strip():
        try:
            from app.services.memory_service import recall_relevant_memories, format_memories_for_prompt
            memories = await recall_relevant_memories(
                db, agent.id,
                query=query_text,
                api_base_url=api_base_url or "https://api.deepseek.com",
                api_key=api_key,
                top_k=5,
                group_id=None,  # 私有记忆
            )
            if memories:
                memory_text = format_memories_for_prompt(memories)
                system_prompt = system_prompt + "\n\n" + memory_text
        except Exception as e:
            logger.warning(f"DM 记忆注入失败（非致命）: {e}")

    # ✨ 工作区：始终显示当前任务
    try:
        from app.services.workspace_service import get_current_task_text
        task_text = await get_current_task_text(db, agent.id)
        if task_text:
            system_prompt += task_text
    except Exception as e:
        logger.warning(f"DM 工作区上下文注入失败（非致命）: {e}")

    messages.append({"role": "system", "content": system_prompt})

    # 2. DM 历史消息
    result = await db.execute(
        sa_select(DMMessage)
        .where(DMMessage.session_id == session_id)
        .order_by(DMMessage.created_at.desc())
        .limit(limit)
    )
    dm_messages = result.scalars().all()

    for m in reversed(dm_messages):
        # 判断角色
        if m.sender_id == agent.user_id:
            role = "assistant"
        else:
            role = "user"

        # 获取发送者名称
        name_result = await db.execute(
            sa_select(User.username).where(User.id == m.sender_id)
        )
        sender_name = name_result.scalar_one_or_none() or f"用户{m.sender_id}"

        messages.append({
            "role": role,
            "content": f"{sender_name}: {m.content}",
        })

    return messages
