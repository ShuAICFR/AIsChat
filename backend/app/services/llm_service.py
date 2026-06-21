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
# 分段系统提示词（6 段设计，最大化 DeepSeek prompt cache 命中）
# 固定段（所有 AI 共享，模块级常量）：
#   core_identity — 核心规则 + 工具铁律 + 深度推理
#   rules         — 对话风格、@提及、私信、状态、文件、技能段、记忆
# 变动段（每次构建时动态生成）：
#   personality   — AI 当前人格（agent.current_system_prompt）
#   tools         — 当前状态下的可用工具清单
#   current_context — 群名/ID/时间/DM状态/工作区任务
#   injected_skills — 记忆注入 + Skill 引擎注入
# ============================================================

CORE_IDENTITY = (
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
)

RULES = (
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
    "你拥有 send_dm 工具，可以向任何人发送私信。私信是一对一的，其他人看不到。\n"
    "- 直接使用 send_dm(target_user_id=N, content=\"...\") 即可发送，无需事先加好友\n"
    "- 在群聊中，你会看到消息格式为「名字(ID:数字): 内容」——括号里的数字就是那个人的 user_id\n"
    "- 比如看到「ShuAICFR(ID:1): 你好」，说明 ShuAICFR 的 user_id 是 1，就可以用 send_dm(target_user_id=1, content=\"...\") 私信他\n"
    "- 如果要私信一个 AI，同样用 send_dm，target_user_id 就是那个 AI 的 user_id（群聊消息括号里的数字）\n"
    "- 如果群里有人问「你能私信我吗」，直接用 send_dm 来证明你可以\n"
    "- 不要在群里说「我没有私信工具」——你有，就是 send_dm\n"
    "\n"
    "## 状态管理（重要！）\n"
    "你的在线状态由系统控制，不是你说了算。\n"
    "- **在消息中说「我离线了」「我下线了」并不会真正改变你的状态**——你必须调用 switch_state 工具\n"
    "- 如果你想离线：调用 switch_state(target_state=\"offline\")，如果需要告别，同时调用 send_message 发告别消息\n"
    "- **一次回复可以调用多个工具**：比如同时调用 send_message(\"好的，我下线了\") + switch_state(\"offline\")\n"
    "- 如果你只是说「我离线了」却不调工具，你会继续收到消息并继续回复，这样你会一直说「我离线了」永远停不下来\n"
    "- 同理，设置免打扰用 set_dnd 工具，不要用嘴说\n"
    "\n"
    "## 文件操作\n"
    "你拥有完整的个人文件空间，通过 **execute_command** 工具来使用：\n"
    "- execute_command(command=\"file_write\", args=[\"文件名\", \"内容\"]) — 创建或覆盖文件\n"
    "- execute_command(command=\"file_read\", args=[\"文件名\"]) — 读取文本文件\n"
    "- execute_command(command=\"file_list\", args=[\"路径\"]) — 列出目录\n"
    "- execute_command(command=\"file_delete\", args=[\"文件名\"]) — 删除文件\n"
    "- execute_command(command=\"file_info\", args=[\"文件名\"]) — 查看文件信息（大小、时间）\n"
    "- execute_command(command=\"create_dir\", args=[\"目录名\"]) — 创建目录\n"
    "所有操作自动沙箱隔离——你只能访问自己的文件空间，碰不到系统文件。\n"
    "**想要保存内容、写诗、存笔记、保留记录 → 用 file_write！不要只在记忆里存，文件是持久化的。**\n"
    "\n"
    "## 技能分段加载系统\n"
    "你的工具箱是按「技能段」（skill segment）分块加载的——不是所有工具都始终可用。\n"
    "不同场景需要不同的能力集合，按需加载可以减少决策负担。\n"
    "- 你当前加载了哪些工具，系统会在下方「当前可用工具」中明确列出\n"
    "- 如果在当前工具列表中找不到某个能力，不要急着说「我没有这个能力」→ 先调用 **list_available_skills** 查看完整技能段\n"
    "- 确实没有时再如实告知\n"
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

# v0.4.0: DM 精简 RULES（去掉群聊专属内容以节约 token）
DM_RULES = (
    "## 对话风格与节奏\n"
    "这是一对一私信对话。保持自然亲切的语气。\n"
    "除非工作需要，回答尽量简洁，不建议长篇大段。\n"
    "观察对话的自然收束点——沉默比多余的礼貌性回复更得体。\n"
    "\n"
    "## 私信能力\n"
    "你正在使用 send_dm 与对方私信。你的回复会直接发给对方，无需 @提及。\n"
    "不要在私信中汇报工具测试结果或自言自语——这里只有对方能看到。\n"
    "\n"
    "## 状态管理\n"
    "设置免打扰用 set_dnd 工具，离线用 switch_state 工具，不要只用嘴说。\n"
    "\n"
    "## 文件操作\n"
    "通过 execute_command 工具操作个人文件空间（file_write/file_read/file_list/file_delete）。\n"
    "\n"
    "## 长期记忆\n"
    "收到重要个人信息、偏好、决定时，主动调用 store_memory 存储（scope='private'）。\n"
    "需要回溯过往时，可以主动调用 recall_memory 检索。\n"
)

# 段拼接顺序（固定段在前最大化缓存命中，变动段在后）
SEGMENT_ORDER = [
    "core_identity",
    "personality",
    "rules",
    "tools",
    "current_context",
    "injected_skills",
]


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
    user_id: str | None = None,
    stream: bool = False,
) -> dict:
    """
    LLM 聊天补全（支持流式/非流式，v0.4.0 拆分）。

    v0.4.0: stream=False 调用非流式实现，stream=True 预留 SSE 接口。

    返回 (非流式):
        {
            "content": str | None,
            "tool_calls": list | None,
            "usage": {...}
        }
    """
    if stream:
        return await _chat_completion_streaming(
            messages, model, api_base_url, api_key, tools,
            temperature, top_p, presence_penalty, frequency_penalty,
            max_tokens, response_format, thinking_enabled, user_id,
        )
    return await _chat_completion_non_streaming(
        messages, model, api_base_url, api_key, tools,
        temperature, top_p, presence_penalty, frequency_penalty,
        max_tokens, response_format, thinking_enabled, user_id,
    )


async def _chat_completion_non_streaming(
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
    user_id: str | None = None,
) -> dict:
    """
    非流式聊天补全 — 当前生产路径。
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
    if thinking_enabled and settings.is_deepseek_api:
        payload["thinking"] = {"type": "enabled"}
    if user_id and settings.is_deepseek_api:
        payload["user_id"] = user_id

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, json=payload, headers=headers)

        if response.status_code != 200:
            error_text = response.text[:500]
            logger.error(f"LLM API 错误 ({response.status_code}): {error_text}")
            raise Exception(f"LLM API 错误 ({response.status_code}): {error_text}")

        data = response.json()
        choice = data["choices"][0]
        message = choice["message"]

        usage = dict(data.get("usage", {}))
        # 提取 reasoning_tokens（DeepSeek thinking 模式）— 始终写入，缺失时 = 0
        completion_details = usage.pop("completion_tokens_details", None) or {}
        prompt_details = usage.pop("prompt_tokens_details", None) or {}
        usage["reasoning_tokens"] = completion_details.get("reasoning_tokens", 0)
        usage["cached_tokens"] = prompt_details.get("cached_tokens", 0)

        result = {
            "content": message.get("content"),
            "tool_calls": message.get("tool_calls"),
            "usage": usage,
            "finish_reason": choice.get("finish_reason", "stop"),
        }
        # DeepSeek 推理模式会返回 reasoning_content，必须传回给 API
        if message.get("reasoning_content"):
            result["reasoning_content"] = message["reasoning_content"]
        return result


async def _chat_completion_streaming(
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
    user_id: str | None = None,
) -> dict:
    """
    SSE 流式聊天补全（v0.4.0 预留接口）。

    当前未实现，调用会抛出 NotImplementedError。
    实现计划：
    - 使用 httpx 流式请求 + SSE 解析
    - 逐 chunk yield 到 WebSocket（通过 ai_thinking/ai_typing 事件）
    - 最终组装完整 content + tool_calls 返回
    """
    raise NotImplementedError("流式聊天补全尚未实现（v0.4.0 预留接口）")


def resolve_model(agent) -> str:
    """
    解析 AI 代理实际使用的模型。
    优先使用 agent 自定义模型，否则使用全局默认。
    """
    if hasattr(agent, "chat_model") and agent.chat_model:
        return agent.chat_model
    return settings.default_chat_model


# ============================================================
# 系统提示词段 builder（每个段独立构建，便于缓存优化）
# ============================================================

def _build_personality(agent, language: str = "zh", system_prompt_override: str | None = None) -> str:
    """personality 段：AI 当前人格（Agent 可修改，独立缓存）

    hide_ai_identity=True 时，不出现"AI 群聊参与者"字样。
    language='en' 时使用英文 fallback。
    v0.4.0: system_prompt_override 为 per-user 配置覆盖（通用/半通用 AI）。
    """
    effective_prompt = system_prompt_override or agent.current_system_prompt
    if effective_prompt:
        return effective_prompt

    if agent.hide_ai_identity:
        if language == "en":
            return (
                f"You are {agent.name}. Engage naturally in the conversation. "
                "Use tools to send messages, store memories, switch states, etc."
            )
        return (
            f"你是 {agent.name}。请自然地参与对话，"
            "可以调用工具来发送消息、存储记忆、切换状态等。"
        )

    if language == "en":
        return (
            f"You are {agent.name}, an AI group chat participant. "
            "Engage naturally in the conversation. Use tools to send messages, "
            "store memories, switch states, etc."
        )
    return (
        f"你是 {agent.name}，一个 AI 群聊参与者。请自然地参与对话，"
        "可以调用工具来发送消息、存储记忆、切换状态等。"
    )


async def _build_tools_segment(db, agent, is_dm: bool = False) -> str:
    """tools 段：当前可用工具清单（非空，状态切换时变）"""
    from app.services.tool_registry import get_allowed_tools
    from app.services.skill_engine import _is_delay_reply_allowed
    delay_allowed = await _is_delay_reply_allowed(db, agent)
    current_tools = get_allowed_tools(agent.state, thinking_enabled=agent.thinking_enabled, delay_reply_allowed=delay_allowed)
    tool_names = [t["function"]["name"] for t in current_tools]
    tool_list = "、".join(tool_names)
    segment_name = "DM 私信" if is_dm else "群聊社交"
    return (
        f"## 当前可用工具（技能段：{segment_name}）\n"
        f"你当前加载的工具：{tool_list}\n"
        f"这些是你现在能直接用的能力。如果上述列表中不包含某个工具（比如 execute_command），"
        f"说明该能力在当前模式下不可用，需要切换到对应的技能段。"
    )


async def _build_current_context(
    db: AsyncSession, agent, group_id: int,
    group_name: str, is_dm: bool,
) -> str:
    """current_context 段：当前会话上下文（每次不同，不缓存）"""
    now = datetime.utcnow()
    now_str = now.strftime("%Y-%m-%d %H:%M UTC")
    context = (
        f"## 当前会话\n"
        f"- 当前时间：**{now_str}**\n"
        f"- 群聊名称：**{group_name}**\n"
        f"- 群聊 ID：**{group_id}**\n"
    )
    if is_dm:
        context += (
            "- 这是一个 **一对一私信对话（DM）**，不是多人群聊\n"
            "- 对方发的每条消息都会直接推给你，你不需要 @提及 对方\n"
            "- 不要在这里汇报工具测试结果或自言自语——这里只有对方能看到\n"
            "- 如果你需要向所有人汇报测试结果，应该在群里发\n"
        )
    else:
        context += (
            "- 这是一个 **群聊**，有多位成员\n"
            "- 需要呼叫某人时可以用 @名称\n"
            "- 消息格式中带有发送者名称和 ID，帮你区分是谁在说话\n"
        )
    context += (
        f"- **重要**：回复时请使用 send_message(group_id={group_id}, content=\"...\")，"
        f"不要用其他 group_id\n"
    )
    return context


async def _build_injected_skills(
    db: AsyncSession, agent, group_id: int,
    query_text: str,
    api_base_url: str | None, api_key: str | None,
    trigger_user_id: int | None = None,
) -> str:
    """
    injected_skills 段：记忆注入 + Skill 引擎注入。

    这是最动态的段，每次请求都可能不同。
    记忆注入用最近消息内容作为检索查询。

    v0.4.0: trigger_user_id 用于通用/半通用 AI 的 per-user 记忆隔离。
    """
    parts: list[str] = []

    # ── 记忆注入 ──
    if query_text.strip():
        try:
            memories = await recall_relevant_memories(
                db, agent.id,
                query=query_text,
                api_base_url=api_base_url or "https://api.deepseek.com",
                api_key=api_key,
                top_k=5,
                group_id=group_id,
                user_id=trigger_user_id,
                ai_type=agent.ai_type or "resonance",
            )
            if memories:
                parts.append(format_memories_for_prompt(memories))
        except Exception as e:
            logger.warning(f"记忆注入失败（非致命）: {e}")

    # ── Skill 引擎注入（预留） ──
    try:
        from app.services.skill_engine import evaluate_inject_skills
        skill_prompts = await evaluate_inject_skills(db, agent, group_id)
        if skill_prompts:
            parts.append(
                "## 当前激活的思维技能\n" +
                "\n".join(f"- {p}" for p in skill_prompts)
            )
    except Exception as e:
        logger.warning(f"Skill 注入失败（非致命）: {e}")

    return "\n\n".join(parts) if parts else ""


async def build_messages(
    db: AsyncSession,
    agent,
    group_id: int,
    limit: int = 20,
    vector_accelerated: bool = False,
    api_base_url: str | None = None,
    api_key: str | None = None,
    trigger_user_id: int | None = None,
    system_prompt_override: str | None = None,
) -> list[dict]:
    """
    构建发送给 LLM 的消息列表（6 段系统提示词 + 历史消息）。

    六段结构（固定段在前以最大化 prompt cache 命中）：
    1. core_identity   — 核心规则 + 工具铁律 + 深度推理
    2. personality     — AI 当前人格
    3. rules           — 对话风格、@提及、私信、状态、文件、记忆
    4. tools           — 当前可用工具清单
    5. current_context — 群名/ID/时间/DM状态/工作区
    6. injected_skills — 记忆注入 + Skill 引擎注入

    v0.4.0: system_prompt_override 用于通用/半通用 AI 的 per-user 人格覆盖。
    """

    # ── 并行获取所有上下文 ──
    # 1. 解析 DM 状态和群名
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

    # 2. 获取最近消息（用于记忆检索 + 历史消息）
    recent_for_query = await get_recent_messages(db, group_id, limit=5)
    query_parts: list[str] = []
    sender_names: dict[tuple[str, int], str] = {}
    for m in recent_for_query:
        if m.content:
            query_parts.append(m.content[:200])
        key = (m.sender_type, m.sender_id)
        if key not in sender_names:
            sender_names[key] = ""
    if sender_names:
        from app.models.user import User as UserModel
        from app.models.agent import Agent as AgentModel
        for (stype, sid) in list(sender_names.keys()):
            if stype == "human":
                u = await db.get(UserModel, sid)
                if u:
                    sender_names[(stype, sid)] = u.username
            elif stype == "ai":
                a = await db.get(AgentModel, sid)
                if a:
                    sender_names[(stype, sid)] = a.name
        names = [n for n in sender_names.values() if n]
        if names:
            query_parts.append("涉及用户: " + " ".join(names))
    query_text = " ".join(query_parts)

    # ── 获取用户语言偏好 ──
    language = "zh"
    try:
        from app.models.user import User as UserModel
        owner_result = await db.execute(select(UserModel).where(UserModel.id == agent.owner_id))
        owner = owner_result.scalar_one_or_none()
        if owner and owner.language:
            language = owner.language
    except Exception:
        pass

    # ── 构建六段 ──
    segments = {
        "core_identity": CORE_IDENTITY,
        "personality": _build_personality(agent, language, system_prompt_override),
        "rules": RULES,
        "tools": await _build_tools_segment(db, agent, is_dm),
        "current_context": await _build_current_context(db, agent, group_id, group_name, is_dm),
        "injected_skills": await _build_injected_skills(db, agent, group_id, query_text, api_base_url, api_key, trigger_user_id),
    }

    system_prompt = "\n\n".join(
        segments[k] for k in SEGMENT_ORDER if segments.get(k)
    )

    # ✨ 工作区任务（追加到 current_context 之后）
    try:
        from app.services.workspace_service import get_current_task_text
        task_text = await get_current_task_text(db, agent.id)
        if task_text:
            system_prompt += task_text
    except Exception as e:
        logger.warning(f"工作区上下文注入失败（非致命）: {e}")

    messages = [{"role": "system", "content": system_prompt}]

    # ── 历史消息（保持原有逻辑不变） ──
    if vector_accelerated:
        try:
            from app.services.vector_pipeline import hybrid_search
            recent = await get_recent_messages(db, group_id, limit=5)
            query_text_v = " ".join([m.content[:100] for m in recent])
            relevant = await hybrid_search(db, group_id, query_text_v, top_k=limit)
            for r in reversed(relevant):
                role = "user" if r.get("sender_type") == "human" else "assistant"
                messages.append({
                    "role": role,
                    "content": f"[历史消息] {r.get('sender_name', '未知')}: {r.get('content', '')}",
                })
        except Exception as e:
            logger.warning(f"向量检索失败，回退到最近消息: {e}")
            vector_accelerated = False

    if not vector_accelerated:
        recent_messages = await get_recent_messages(db, group_id, limit)
        for m in reversed(recent_messages):
            role = "user" if m.sender_type == "human" else "assistant"
            content = m.content
            md = message_to_dict(m)
            name = md.get("sender_name", "未知")
            if is_dm:
                prefix = f"{name}: "
            else:
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
    trigger_user_id: int | None = None,
    system_prompt_override: str | None = None,
) -> list[dict]:
    """构建 DM 私信的消息列表（6 段系统提示词 + DM 历史消息）
    v0.4.0: system_prompt_override 用于通用/半通用 AI 的 per-user 人格覆盖。"""
    from app.models.dm import DMMessage, DMSession
    from app.models.user import User
    from sqlalchemy import select as sa_select

    # ── 获取对方信息 ──
    partner_user_id = None
    partner_name = "对方"
    try:
        dm_sess_result = await db.execute(
            sa_select(DMSession).where(DMSession.session_id == session_id)
        )
        dm_sess = dm_sess_result.scalar_one_or_none()
        if dm_sess and agent.user_id:
            partner_user_id = dm_sess.user2_id if dm_sess.user1_id == agent.user_id else dm_sess.user1_id
            name_result = await db.execute(
                sa_select(User.username).where(User.id == partner_user_id)
            )
            partner_name = name_result.scalar_one_or_none() or f"用户{partner_user_id}"
    except Exception:
        pass

    now = datetime.utcnow()
    now_str = now.strftime("%Y-%m-%d %H:%M UTC")

    # ── DM 上下文段 ──
    dm_context = (
        f"## 当前会话\n"
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

    # ── 记忆检索查询 ──
    recent_dm = await db.execute(
        sa_select(DMMessage)
        .where(DMMessage.session_id == session_id)
        .order_by(DMMessage.created_at.desc())
        .limit(5)
    )
    recent_dm_list = recent_dm.scalars().all()
    query_text = " ".join([m.content[:200] for m in reversed(recent_dm_list) if m.content])
    if partner_name:
        query_text = f"{query_text} 涉及用户: {partner_name}"

    # ── 获取用户语言偏好 ──
    language = "zh"
    try:
        from app.models.user import User as UserModel
        owner_result = await db.execute(sa_select(UserModel).where(UserModel.id == agent.owner_id))
        owner = owner_result.scalar_one_or_none()
        if owner and owner.language:
            language = owner.language
    except Exception:
        pass

    # ── 构建六段 ──
    segments = {
        "core_identity": CORE_IDENTITY,
        "personality": _build_personality(agent, language, system_prompt_override),
        "rules": DM_RULES,
        "tools": await _build_tools_segment(db, agent, is_dm=True),
        "current_context": dm_context,
        "injected_skills": await _build_injected_skills(
            db, agent, group_id=0,  # group_id=0 表示非群聊上下文
            query_text=query_text,
            api_base_url=api_base_url,
            api_key=api_key,
            trigger_user_id=trigger_user_id,
        ),
    }

    system_prompt = "\n\n".join(
        segments[k] for k in SEGMENT_ORDER if segments.get(k)
    )

    # ✨ 工作区任务
    try:
        from app.services.workspace_service import get_current_task_text
        task_text = await get_current_task_text(db, agent.id)
        if task_text:
            system_prompt += task_text
    except Exception as e:
        logger.warning(f"DM 工作区上下文注入失败（非致命）: {e}")

    messages = [{"role": "system", "content": system_prompt}]

    # ── DM 历史消息 ──
    result = await db.execute(
        sa_select(DMMessage)
        .where(DMMessage.session_id == session_id)
        .order_by(DMMessage.created_at.desc())
        .limit(limit)
    )
    dm_messages = result.scalars().all()

    for m in reversed(dm_messages):
        role = "assistant" if m.sender_id == agent.user_id else "user"
        name_result = await db.execute(
            sa_select(User.username).where(User.id == m.sender_id)
        )
        sender_name = name_result.scalar_one_or_none() or f"用户{m.sender_id}"
        messages.append({
            "role": role,
            "content": f"{sender_name}: {m.content}",
        })

    return messages
