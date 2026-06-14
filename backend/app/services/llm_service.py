"""
LLM 调用抽象层
提供通用的聊天补全（支持工具调用）、模型解析、消息构建
"""
import json
import logging
import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings

logger = logging.getLogger(__name__)


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

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=payload, headers=headers)

        if response.status_code != 200:
            error_text = response.text[:500]
            logger.error(f"LLM API 错误 ({response.status_code}): {error_text}")
            raise Exception(f"LLM API 错误 ({response.status_code}): {error_text}")

        data = response.json()
        choice = data["choices"][0]
        message = choice["message"]

        return {
            "content": message.get("content"),
            "tool_calls": message.get("tool_calls"),
            "usage": data.get("usage", {}),
            "finish_reason": choice.get("finish_reason", "stop"),
        }


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
    from app.services.group_service import get_recent_messages

    messages = []

    # ═══════════════════════════════════════════════════
    # 固定前缀块（所有 AI 共享，最大化 prompt cache 命中）
    # ═══════════════════════════════════════════════════
    fixed_prefix = (
        "## 核心规则：一切操作都必须通过工具调用\n"
        "你可以把工具调用理解为你的「手」——说话、切状态、发私信、存记忆，都是用手去做的事。\n"
        "**你的文字不会自动发送！** 你必须显式调用 send_message 工具来发送消息。\n"
        "- 如果你只返回文字但不调用任何工具 → 系统会驳回并提示你使用工具\n"
        "- 如果你想说话 → 调用 send_message(group_id=当前群ID, content=\"你想说的话\")\n"
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
        "- 如果群里有人问「你能私信我吗」，你应该用 send_dm 来证明你可以\n"
        "- 不要在群里说「我没有私信工具」——你有，就是 send_dm\n"
        "- 如果对方做了某件事或说了某句话让你想私下回应，大胆使用 send_dm\n"
        "\n"
        "## 状态管理（重要！）\n"
        "你的在线状态由系统控制，不是你说了算。\n"
        "- **在消息中说「我离线了」「我下线了」并不会真正改变你的状态**——你必须调用 switch_state 工具\n"
        "- 如果你想离线：调用 switch_state(target_state=\"offline\")，如果需要告别，同时调用 send_message 发告别消息\n"
        "- **一次回复可以调用多个工具**：比如同时调用 send_message(\"好的，我下线了\") + switch_state(\"offline\")\n"
        "- 如果你只是说「我离线了」却不调工具，你会继续收到消息并继续回复，这样你会一直说「我离线了」永远停不下来\n"
        "- 同理，设置免打扰用 set_dnd 工具，不要用嘴说\n"
        "\n"
        "## 工具调用铁律（极其重要！违反即为失职）\n"
        "当你需要执行某个操作时，**直接调用对应的工具函数（function call），不要在消息正文中用括号描述技术操作**。\n"
        "- ❌ 错误：「（调用工具）」「（查了一下记忆）」「（确认状态已切换）」「（翻了翻工具）」——这些都是文字，不会触发任何实际操作\n"
        "- ✅ 正确：直接发起 function call，同时可以在消息正文中说「好的，已下线」\n"
        "- **工具调用和文字消息可以同时存在**：你可以先发一条告别消息，同时调用 switch_state\n"
        "- **表情和肢体描写不受此限**：像「（低头，嘴角露出一丝苦笑）」「（轻轻点头）」「（笑了笑）」这些角色表达完全没问题，很可爱，继续保持\n"
        "- 判断标准：如果括号里描述的是**你能用工具做到的事**（查记忆/发消息/切状态/建群/私信）→ 直接调工具；如果描述的是**角色的情感和动作** → 括号表达完全OK\n"
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
        "- 系统已自动注入了最相关的记忆，但你可以主动检索更多"
    )

    # ═══════════════════════════════════════════════════
    # 变动块（每个 AI / 每次请求不同，附加在固定前缀之后）
    # ═══════════════════════════════════════════════════
    # 1. AI 人格 prompt
    custom_prompt = agent.current_system_prompt or (
        f"你是 {agent.name}，一个 AI 群聊参与者。请自然地参与对话，"
        "可以调用工具来发送消息、存储记忆、切换状态等。"
    )

    system_prompt = fixed_prefix + "\n\n" + custom_prompt

    # 1b. 先获取最近消息片段，用作记忆检索的查询
    recent_for_query = await get_recent_messages(db, group_id, limit=5)
    query_text = " ".join([m.content[:200] for m in recent_for_query if m.content])

    # 1c. 注入相关记忆（用最近消息内容作为检索查询，含私有+群共享）
    if query_text.strip():
        try:
            from app.services.memory_service import recall_relevant_memories, format_memories_for_prompt
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
            from app.services.group_service import message_to_dict
            md = message_to_dict(m)
            name = md.get("sender_name", "未知")
            messages.append({
                "role": role,
                "content": f"{name}(ID:{m.sender_id}): {content}" if role == "user" else f"{name}(ID:{m.sender_id}): {content}",
            })

    return messages
