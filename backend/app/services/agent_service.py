"""
AI 代理服务
处理 AI 代理的 CRUD、配置修改、状态切换、回滚等
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from app.models.user import User
from app.models.agent import Agent, AgentConfigHistory
from app.models.memory import RoughMemory, DetailMemory
from app.config import settings
from app.utils.text import extract_mentions

logger = logging.getLogger(__name__)

# 三档 AI 配置预设值
CONFIG_PROFILES = {
    "chat": {
        "name": "聊天档",
        "description": "被动响应 · 低成本 — 只回答你问的，不多说一句",
        # 模型参数
        "temperature": 0.7, "top_p": 0.9, "presence_penalty": 0.3, "frequency_penalty": 0.3,
        "thinking_enabled": False,
        # 工具调用
        "max_tool_rounds": 2,
        "alarm_max_tool_rounds": 5,
        # 闹钟 / 心跳
        "force_alarm_on_end": False,
        "max_alarms": 3,
        # 行为开关
        "delay_reply_enabled": False,
        "is_ai_editable": False,
        "hide_ai_identity": True,
    },
    "immersive": {
        "name": "深度沉浸档",
        "description": "半自主 · 按需参与 — 能自己进群、深度响应，但不主动制造话题",
        # 模型参数
        "temperature": 0.9, "top_p": 0.95, "presence_penalty": 0.5, "frequency_penalty": 0.5,
        "thinking_enabled": True,
        # 工具调用
        "max_tool_rounds": 4,
        "alarm_max_tool_rounds": 8,
        # 闹钟 / 心跳
        "force_alarm_on_end": False,
        "max_alarms": 5,
        # 行为开关
        "delay_reply_enabled": True,
        "is_ai_editable": True,
        "hide_ai_identity": False,
    },
    "digital_life": {
        "name": "数字生命档",
        "description": "持续在线 · 主动行为 — 自己思考、整理、交友、冲浪",
        # 模型参数
        "temperature": 1.1, "top_p": 0.95, "presence_penalty": 0.6, "frequency_penalty": 0.6,
        "thinking_enabled": True,
        # 工具调用
        "max_tool_rounds": 10,
        "alarm_max_tool_rounds": 15,
        # 闹钟 / 心跳
        "force_alarm_on_end": True,
        "max_alarms": 20,
        # 行为开关
        "delay_reply_enabled": True,
        "is_ai_editable": True,
        "hide_ai_identity": False,
    },
}


# 预设档位顺序（用于判断升降级方向）
_PRESET_ORDER = {"custom": 0, "chat": 1, "immersive": 2, "digital_life": 3}

# 强相关参数：切换预设时按升降级规则合并
_STRONG_NUMERIC_PARAMS = [
    "temperature", "top_p", "presence_penalty", "frequency_penalty",
    "max_tool_rounds", "alarm_max_tool_rounds", "max_alarms",
]
_STRONG_BOOL_PARAMS = [
    "thinking_enabled", "force_alarm_on_end", "is_ai_editable",
]
# 无关参数：切换预设时永远不改
_INDEPENDENT_PARAMS = [
    "hide_ai_identity", "delay_reply_enabled",
    # 以下在 preset dict 中不存在但列出来明确语义
    # "system_prompt", "chat_model", "work_model", "api_base_url",
    # "api_key_encrypted", "api_credit_cost", "avatar_url", "name",
]


def _merge_preset_values(
    old_profile: str,
    new_profile: str,
    current_values: dict,
    preset_values: dict,
) -> tuple[dict, list[str]]:
    """
    按升降级规则合并预设值，返回 (合并后的值, 变更字段列表)。

    升级（chat→immersive→digital_life）：
      - 数值：max(当前, 预设) — 用户拉高的保留
      - 布尔：当前 OR 预设 — 任一开即开

    降级（逆向）：
      - 数值：min(当前, 预设) — 用户拉低的保留
      - 布尔：当前 AND 预设 — 都开才开

    custom→任意预设视为升级；任意预设→custom 不做任何变更。
    """
    old_order = _PRESET_ORDER.get(old_profile, 0)
    new_order = _PRESET_ORDER.get(new_profile, 0)

    # custom → custom 或 预设 → custom：不改任何值
    if new_profile == "custom":
        return {}, []

    is_upgrade = new_order > old_order  # custom→预设 也是升级

    merged = {}
    changed: list[str] = []

    for key in _STRONG_NUMERIC_PARAMS:
        if key not in preset_values:
            continue
        cur = current_values.get(key)
        pre = preset_values[key]
        if cur is None:
            merged[key] = pre
            changed.append(key)
        elif is_upgrade:
            merged[key] = max(cur, pre)
            if merged[key] != cur:
                changed.append(key)
        else:
            merged[key] = min(cur, pre)
            if merged[key] != cur:
                changed.append(key)

    for key in _STRONG_BOOL_PARAMS:
        if key not in preset_values:
            continue
        cur = current_values.get(key)
        pre = preset_values[key]
        if cur is None:
            merged[key] = pre
            changed.append(key)
        elif is_upgrade:
            merged[key] = cur or pre
            if merged[key] != cur:
                changed.append(key)
        else:
            merged[key] = cur and pre
            if merged[key] != cur:
                changed.append(key)

    return merged, changed


async def apply_config_profile(
    db: AsyncSession,
    agent_id: int,
    profile: str,
    operator_id: int | None = None,
    dry_run: bool = False,
) -> Agent | dict:
    """
    应用（或预览）预设配置档。

    - 首次应用（config_profile='custom'）：直接写入全部强相关值
    - 切换预设：按升降级规则智能合并，保护用户手动调整

    设置 dry_run=True 返回预览 dict 而非实际写入。
    """
    if profile not in CONFIG_PROFILES:
        raise ValueError(f"无效的配置档: {profile}，可选: {list(CONFIG_PROFILES.keys())}")

    agent = await get_agent(db, agent_id)
    if agent is None:
        raise ValueError("AI 代理不存在")

    preset = CONFIG_PROFILES[profile]
    old_profile = agent.config_profile or "custom"

    # 收集当前强相关值
    current_values = {
        "temperature": agent.current_temperature,
        "top_p": agent.current_top_p,
        "presence_penalty": agent.current_presence_penalty,
        "frequency_penalty": agent.current_frequency_penalty,
        "thinking_enabled": agent.thinking_enabled,
        "max_tool_rounds": agent.max_tool_rounds,
        "alarm_max_tool_rounds": agent.alarm_max_tool_rounds,
        "force_alarm_on_end": agent.force_alarm_on_end,
        "max_alarms": agent.max_alarms,
        "is_ai_editable": agent.is_ai_editable,
    }

    # 合并
    merged, changed = _merge_preset_values(old_profile, profile, current_values, preset)

    # 预览模式
    if dry_run:
        changes_detail = {}
        for key in changed:
            changes_detail[key] = {
                "old": current_values.get(key),
                "new": merged[key],
            }
        return {
            "direction": "upgrade" if _PRESET_ORDER.get(profile, 0) > _PRESET_ORDER.get(old_profile, 0) else "downgrade",
            "old_profile": old_profile,
            "new_profile": profile,
            "changed_fields": changes_detail,
            "unchanged_strong": [k for k in _STRONG_NUMERIC_PARAMS + _STRONG_BOOL_PARAMS if k in preset and k not in changed],
            "independent_untouched": [k for k in _INDEPENDENT_PARAMS if hasattr(agent, k)],
        }

    # 实际写入
    # 保存历史快照
    history = AgentConfigHistory(
        agent_id=agent.id,
        system_prompt=agent.current_system_prompt,
        temperature=agent.current_temperature,
        top_p=agent.current_top_p,
        presence_penalty=agent.current_presence_penalty,
        frequency_penalty=agent.current_frequency_penalty,
    )
    db.add(history)

    # 写入合并后的强相关值
    for key, value in merged.items():
        if key in ("temperature", "top_p", "presence_penalty", "frequency_penalty"):
            setattr(agent, f"current_{key}", value)
        elif hasattr(agent, key):
            setattr(agent, key, value)

    # 档位标记
    agent.config_profile = profile

    await db.flush()
    logger.info(
        f"🎚️ AI({agent_id}) 切换预设: {old_profile} → {profile}"
        f"（{'升级' if _PRESET_ORDER.get(profile,0) > _PRESET_ORDER.get(old_profile,0) else '降级'}），"
        f"变更 {len(changed)} 项: {changed}"
    )
    return agent


async def create_agent(
    db: AsyncSession,
    owner_id: int,
    name: str,
    system_prompt: str | None = None,
    temperature: float = 0.8,
    top_p: float = 0.9,
    presence_penalty: float = 0.5,
    frequency_penalty: float = 0.5,
    chat_model: str | None = None,
    work_model: str | None = None,
    thinking_enabled: bool = False,
    is_admin: bool = False,
    api_credit_cost: int = 0,
    hide_ai_identity: bool = False,
    delay_reply_enabled: bool | None = None,
    config_profile: str | None = None,
    max_tool_rounds: int = 3,
    alarm_max_tool_rounds: int = 10,
    force_alarm_on_end: bool = False,
    max_alarms: int = 10,
    is_ai_editable: bool = True,
) -> Agent:
    """
    创建 AI 代理。
    管理员创建不限额度；普通用户需有剩余 ai_quota（仅作上限检查，不扣除）。
    实际 API 调用消耗 api_credit。
    """
    # 查询用户（额度检查和日志都需要）
    result = await db.execute(select(User).where(User.id == owner_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise ValueError("用户不存在")

    if not is_admin:
        if user.ai_quota <= 0:
            raise ValueError("AI 创建额度不足，请联系管理员获取兑换码")

    # 创建 Agent 对应的 users 条目（统一 ID 空间，用于私信等场景）
    ai_user = User(
        username=f"{name}_agent",
        type="ai",
        password_hash="",
        role="ai",
        is_active=True,
    )
    db.add(ai_user)
    await db.flush()

    # 解析 delay_reply_enabled：None = 继承全局默认
    if delay_reply_enabled is None:
        from app.models.conversation_log import ConversationLogConfig
        cfg_result = await db.execute(select(ConversationLogConfig).limit(1))
        cfg = cfg_result.scalar_one_or_none()
        delay_reply_enabled = cfg.default_delay_reply_enabled if cfg else False

    # 创建 Agent
    agent = Agent(
        owner_id=owner_id,
        name=name,
        user_id=ai_user.id,
        original_system_prompt=system_prompt,
        original_temperature=temperature,
        original_top_p=top_p,
        original_presence_penalty=presence_penalty,
        original_frequency_penalty=frequency_penalty,
        current_system_prompt=system_prompt,
        current_temperature=temperature,
        current_top_p=top_p,
        current_presence_penalty=presence_penalty,
        current_frequency_penalty=frequency_penalty,
        chat_model=chat_model,
        work_model=work_model,
        thinking_enabled=thinking_enabled,
        config_profile=config_profile,
        state="active",
        api_credit_cost=api_credit_cost,
        hide_ai_identity=hide_ai_identity,
        delay_reply_enabled=delay_reply_enabled,
        max_tool_rounds=max_tool_rounds,
        alarm_max_tool_rounds=alarm_max_tool_rounds,
        force_alarm_on_end=force_alarm_on_end,
        max_alarms=max_alarms,
        is_ai_editable=is_ai_editable,
    )
    db.add(agent)
    await db.flush()
    await db.refresh(agent)

    logger.info(f"AI '{name}' (id={agent.id}) 由用户 id={owner_id} 创建，api_credit_cost={api_credit_cost}")
    return agent


async def get_agent(db: AsyncSession, agent_id: int, owner_id: int | None = None) -> Agent | None:
    """获取单个 Agent"""
    query = select(Agent).where(Agent.id == agent_id)
    if owner_id is not None:
        query = query.where(Agent.owner_id == owner_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def list_agents(db: AsyncSession, owner_id: int) -> list[Agent]:
    """列出用户的所有 Agent"""
    result = await db.execute(
        select(Agent).where(Agent.owner_id == owner_id).order_by(Agent.created_at.desc())
    )
    return list(result.scalars().all())


async def delete_agent(
    db: AsyncSession,
    agent_id: int,
    operator_id: int,
    is_admin: bool = False,
) -> dict:
    """
    删除 AI 代理，返还 api_credit_cost 给创建者。
    同时删除关联的 users 条目（type='ai'）。
    """
    agent = await get_agent(db, agent_id)
    if agent is None:
        raise ValueError("AI 代理不存在")

    # 权限检查
    if not is_admin and agent.owner_id != operator_id:
        raise ValueError("无权删除此 AI")

    returned_credit = agent.api_credit_cost
    owner_id = agent.owner_id

    # 返还 API 额度
    if returned_credit > 0:
        result = await db.execute(select(User).where(User.id == owner_id))
        owner = result.scalar_one_or_none()
        if owner:
            owner.api_credit += returned_credit

    # 删除关联的 User（type='ai'）
    if agent.user_id:
        await db.execute(select(User).where(User.id == agent.user_id))
        ai_user_result = await db.execute(select(User).where(User.id == agent.user_id))
        ai_user = ai_user_result.scalar_one_or_none()
        if ai_user:
            await db.delete(ai_user)

    agent_name = agent.name
    await db.delete(agent)
    await db.flush()

    logger.info(
        f"AI '{agent_name}' (id={agent_id}) 已删除，"
        f"返还 {returned_credit} API 额度给用户 id={owner_id}"
    )
    return {
        "message": f"AI '{agent_name}' 已删除",
        "agent_id": agent_id,
        "returned_credit": returned_credit,
    }


async def update_agent_config(
    db: AsyncSession,
    agent_id: int,
    operator_id: int,
    updates: dict,
    is_admin: bool = False,
) -> Agent:
    """
    更新 AI 配置。
    如果 is_ai_editable 为 false 且操作者不是管理员，则拒绝。
    修改前自动保存历史记录。
    """
    agent = await get_agent(db, agent_id)
    if agent is None:
        raise ValueError("AI 代理不存在")

    # 权限检查
    if not is_admin:
        if agent.owner_id != operator_id:
            raise ValueError("无权修改此 AI 配置")
        if not agent.is_ai_editable:
            raise ValueError("此 AI 不允许自修改配置")

    # 保存历史记录（修改前的值）
    history = AgentConfigHistory(
        agent_id=agent.id,
        system_prompt=agent.current_system_prompt,
        temperature=agent.current_temperature,
        top_p=agent.current_top_p,
        presence_penalty=agent.current_presence_penalty,
        frequency_penalty=agent.current_frequency_penalty,
    )
    db.add(history)

    # 应用更新
    allowed_fields = [
        "system_prompt", "temperature", "top_p",
        "presence_penalty", "frequency_penalty",
    ]
    for field in allowed_fields:
        if field in updates and updates[field] is not None:
            setattr(agent, f"current_{field}", updates[field])

    # thinking_enabled 是简单布尔，不遵循 current_* 模式
    if "thinking_enabled" in updates and updates["thinking_enabled"] is not None:
        agent.thinking_enabled = updates["thinking_enabled"]

    # hide_ai_identity 开关
    if "hide_ai_identity" in updates:
        agent.hide_ai_identity = updates["hide_ai_identity"]

    # 头像 URL
    if "avatar_url" in updates:
        agent.avatar_url = updates.get("avatar_url")

    # 单 AI 级 API 配置
    if "api_base_url" in updates:
        agent.api_base_url = updates.get("api_base_url")
    if "api_key" in updates:
        from app.utils.crypto import encrypt_api_key
        api_key_val = updates["api_key"]
        if api_key_val:
            agent.api_key_encrypted = encrypt_api_key(api_key_val)
        elif api_key_val == "":  # 空字符串表示清除
            agent.api_key_encrypted = None

    # chat_model / work_model 允许设为 None（重置为全局默认）
    for field in ("chat_model", "work_model"):
        if field in updates:
            setattr(agent, field, updates[field])  # None = 继承全局

    # delay_reply_enabled 延迟回复开关
    if "delay_reply_enabled" in updates:
        agent.delay_reply_enabled = updates["delay_reply_enabled"]

    # max_tool_rounds 工具调用轮次上限
    if "max_tool_rounds" in updates and updates["max_tool_rounds"] is not None:
        agent.max_tool_rounds = updates["max_tool_rounds"]

    # alarm_max_tool_rounds 闹钟/心跳轮次上限
    if "alarm_max_tool_rounds" in updates and updates["alarm_max_tool_rounds"] is not None:
        agent.alarm_max_tool_rounds = updates["alarm_max_tool_rounds"]

    # force_alarm_on_end 对话结束强制闹钟
    if "force_alarm_on_end" in updates:
        agent.force_alarm_on_end = updates["force_alarm_on_end"]

    # max_alarms 最大闹钟数
    if "max_alarms" in updates and updates["max_alarms"] is not None:
        agent.max_alarms = updates["max_alarms"]

    # config_profile（手动编辑参数时自动回退到 custom）
    if "config_profile" in updates and updates["config_profile"] is not None:
        agent.config_profile = updates["config_profile"]
    elif any(f in updates and updates[f] is not None for f in allowed_fields):
        # 用户手动调了参数 → 不再是预设档
        if agent.config_profile and agent.config_profile != "custom":
            agent.config_profile = "custom"

    await db.flush()
    await db.refresh(agent)

    logger.info(f"AI '{agent.name}' (id={agent.id}) 配置已更新")
    return agent


async def rollback_config(
    db: AsyncSession,
    agent_id: int,
    version_id: int | None = None,
    operator_id: int | None = None,
) -> Agent:
    """
    回滚 AI 配置到历史版本。
    version_id 可以是 agent_config_history.id，或 -1 表示上一版本。
    """
    agent = await get_agent(db, agent_id)
    if agent is None:
        raise ValueError("AI 代理不存在")

    # 查询历史记录
    query = select(AgentConfigHistory).where(
        AgentConfigHistory.agent_id == agent_id
    ).order_by(AgentConfigHistory.created_at.desc())

    if version_id is not None and version_id != -1:
        query = query.where(AgentConfigHistory.id == version_id)

    result = await db.execute(query.limit(1))
    history = result.scalar_one_or_none()

    if history is None:
        raise ValueError("找不到历史版本")

    # 保存当前配置（回滚前）
    current_snapshot = AgentConfigHistory(
        agent_id=agent.id,
        system_prompt=agent.current_system_prompt,
        temperature=agent.current_temperature,
        top_p=agent.current_top_p,
        presence_penalty=agent.current_presence_penalty,
        frequency_penalty=agent.current_frequency_penalty,
    )
    db.add(current_snapshot)

    # 回滚
    agent.current_system_prompt = history.system_prompt
    agent.current_temperature = history.temperature
    agent.current_top_p = history.top_p
    agent.current_presence_penalty = history.presence_penalty
    agent.current_frequency_penalty = history.frequency_penalty

    await db.flush()
    await db.refresh(agent)

    logger.info(f"AI '{agent.name}' (id={agent.id}) 配置已回滚到版本 {history.id}")
    return agent


async def switch_agent_state(
    db: AsyncSession,
    agent_id: int,
    target_state: str,
    duration_hours: int | None = None,
    reason: str | None = None,
) -> Agent:
    """
    切换 AI 状态。
    """
    valid_states = ["active", "dnd", "offline", "blocked"]
    if target_state not in valid_states:
        raise ValueError(f"无效状态: {target_state}，可选: {valid_states}")

    agent = await get_agent(db, agent_id)
    if agent is None:
        raise ValueError("AI 代理不存在")

    # blocked 状态特殊处理
    if target_state == "blocked":
        if duration_hours is None or duration_hours <= 0:
            raise ValueError("blocked 状态需要指定有效的 duration_hours")
        if duration_hours > 72:
            raise ValueError("blocked 状态最长 72 小时")
        from datetime import datetime, timedelta
        agent.offline_until = datetime.utcnow() + timedelta(hours=duration_hours)
    elif target_state == "offline":
        if duration_hours:
            from datetime import datetime, timedelta
            agent.offline_until = datetime.utcnow() + timedelta(hours=duration_hours)
        else:
            agent.offline_until = None
    else:
        agent.offline_until = None

    old_state = agent.state
    agent.state = target_state

    await db.flush()
    await db.refresh(agent)

    logger.info(
        f"AI '{agent.name}' (id={agent.id}) 状态切换: {old_state} → {target_state}"
        + (f", 原因: {reason}" if reason else "")
    )
    return agent


async def get_config_history(
    db: AsyncSession,
    agent_id: int,
    limit: int = 20,
) -> list[AgentConfigHistory]:
    """获取 AI 配置历史"""
    result = await db.execute(
        select(AgentConfigHistory)
        .where(AgentConfigHistory.agent_id == agent_id)
        .order_by(AgentConfigHistory.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def generate_agent_personality(
    description: str,
    api_base_url: str = settings.deepseek_base_url,
    api_key: str | None = None,
) -> dict:
    """
    调用 LLM 辅助生成 AI 性格配置。
    返回包含 name, system_prompt, temperature 等字段的 dict。
    """
    import json
    import httpx

    system_prompt = """你是一个 AI 角色设计师。根据用户描述，生成一个完整的 AI 角色配置。
请严格按照以下 JSON Schema 返回（不要包含 markdown 代码块标记）：
{
  "name": "角色名（2-10字）",
  "system_prompt": "详细的系统提示词（50-500字），定义角色的性格、语气、知识背景和行为方式",
  "temperature": 0.5-1.5之间的浮点数（越高越随机）,
  "top_p": 0.7-1.0之间的浮点数,
  "presence_penalty": -2.0到2.0之间的浮点数,
  "frequency_penalty": -2.0到2.0之间的浮点数
}"""

    async with httpx.AsyncClient(timeout=60.0) as client:
        url = f"{api_base_url}/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        payload = {
            "model": settings.default_chat_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"请为以下描述生成 AI 角色配置：\n{description}"},
            ],
            "temperature": 0.9,
            "response_format": {"type": "json_object"},
        }

        response = await client.post(url, json=payload, headers=headers)

        if response.status_code != 200:
            raise Exception(f"LLM API 错误 ({response.status_code}): {response.text[:500]}")

        data = response.json()
        content = data["choices"][0]["message"]["content"]
        return json.loads(content)


async def calculate_willingness(
    db: AsyncSession,
    agent_id: int,
    group_id: int,
    message_content: str,
) -> int:
    """
    计算 AI 对某条消息的意愿评分（0-100）。
    考虑因素：
    - @ 提及：+40 分
    - 群聊活跃度（最近1小时内消息数）：高活跃 -10，低活跃 +10
    - 当前状态：offline 直接 0
    - 消息长度：过短（<5字）-5，含实质性内容 +10

    注：对话是否应该终止，由管理员通过群设置的「发言频率限制」硬性控制，
    以及系统提示词中的「对话节奏」软性指导。算法层面不再对近期发言做额外惩罚，
    以免错误抑制正常的激烈讨论。
    返回 0-100 分。
    """
    agent = await get_agent(db, agent_id)
    if agent is None:
        return 0

    # offline/blocked 状态不处理
    if agent.state in ("offline", "blocked"):
        return 0

    score = 50  # 基础分

    # 1. @ 提及检测（复用 utils.text 正则，避免子串误匹配）
    mentioned_names = extract_mentions(message_content)
    agent_name_mentioned = agent.name in mentioned_names
    generic_mention = "@ai" in message_content.lower() or "@all" in message_content.lower()
    if agent_name_mentioned:
        score += 40
    elif generic_mention:
        score += 20

    # 2. 消息长度
    if len(message_content) < 5:
        score -= 5
    elif len(message_content) > 50:
        score += 10

    # 3. 群聊活跃度（最近 1 小时消息数）
    from datetime import datetime, timedelta, timezone
    from app.models.message import Message

    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    count_result = await db.execute(
        select(func.count(Message.id)).where(
            Message.group_id == group_id,
            Message.created_at >= one_hour_ago,
        )
    )
    recent_count = count_result.scalar() or 0

    if recent_count > 50:       # 太活跃，可能不想被打扰
        score -= 10
    elif recent_count < 5:      # 较安静，更愿意参与
        score += 10

    # 4. 当前活跃状态的加权
    if agent.state == "dnd":
        score -= 30  # 全局 DND 状态已经很不想被打扰了

    # 限制在 0-100
    return max(0, min(100, score))


async def export_agent_soul(
    db: AsyncSession,
    agent_id: int,
) -> dict:
    """
    导出 AI 灵魂档案：配置 + 历史 + 记忆
    """
    from datetime import datetime, timezone as tz

    agent = await get_agent(db, agent_id)
    if agent is None:
        raise ValueError("AI 代理不存在")

    # 配置历史（最新 100 条）
    history_result = await db.execute(
        select(AgentConfigHistory)
        .where(AgentConfigHistory.agent_id == agent_id)
        .order_by(AgentConfigHistory.created_at.desc())
        .limit(100)
    )
    history = history_result.scalars().all()

    config_history = [
        {
            "system_prompt": h.system_prompt,
            "temperature": h.temperature,
            "top_p": h.top_p,
            "presence_penalty": h.presence_penalty,
            "frequency_penalty": h.frequency_penalty,
            "created_at": str(h.created_at) if h.created_at else None,
        }
        for h in reversed(history)  # 按时间升序
    ]

    # 记忆（最新 500 条 rough + detail）
    rough_result = await db.execute(
        select(RoughMemory)
        .where(
            RoughMemory.owner_type == "ai",
            RoughMemory.owner_id == agent_id,
        )
        .order_by(RoughMemory.created_at.desc())
        .limit(500)
    )
    rough_memories = rough_result.scalars().all()

    memories = []
    for rm in rough_memories:
        detail_result = await db.execute(
            select(DetailMemory)
            .where(DetailMemory.rough_id == rm.id)
            .order_by(DetailMemory.created_at.asc())
        )
        details = detail_result.scalars().all()
        for d in details:
            memories.append({
                "title": rm.title,
                "content": d.content,
                "scope": rm.scope or "private",
                "group_id": rm.group_id,
                "created_at": str(d.created_at) if d.created_at else None,
            })

    return {
        "export_version": "1.0",
        "exported_at": datetime.now(tz).isoformat(),
        "agent_name": agent.name,
        "agent_config": {
            "system_prompt": agent.current_system_prompt,
            "temperature": agent.current_temperature,
            "top_p": agent.current_top_p,
            "presence_penalty": agent.current_presence_penalty,
            "frequency_penalty": agent.current_frequency_penalty,
            "chat_model": agent.chat_model,
            "work_model": agent.work_model,
            "thinking_enabled": agent.thinking_enabled,
        },
        "original_config": {
            "system_prompt": agent.original_system_prompt,
            "temperature": agent.original_temperature,
            "top_p": agent.original_top_p,
            "presence_penalty": agent.original_presence_penalty,
            "frequency_penalty": agent.original_frequency_penalty,
        },
        "config_history": config_history,
        "memories": memories,
    }


async def import_agent_soul(
    db: AsyncSession,
    data: dict,
    owner_id: int,
    import_memories: bool = True,
    is_admin: bool = False,
) -> Agent:
    """
    从灵魂档案导入 AI。
    创建新 Agent + 可选记忆导入。
    """
    cfg = data.get("agent_config", {})
    orig = data.get("original_config", {})
    name = data.get("agent_name", "未命名")

    # 创建新 Agent（会扣配额，admin 免扣）
    agent = await create_agent(
        db,
        owner_id=owner_id,
        name=name,
        system_prompt=orig.get("system_prompt") or cfg.get("system_prompt"),
        temperature=orig.get("temperature", 0.8),
        top_p=orig.get("top_p", 0.9),
        presence_penalty=orig.get("presence_penalty", 0.5),
        frequency_penalty=orig.get("frequency_penalty", 0.5),
        chat_model=cfg.get("chat_model"),
        work_model=cfg.get("work_model"),
        thinking_enabled=cfg.get("thinking_enabled", False),
        is_admin=is_admin,
    )

    # 如果当前配置和原始配置不同，更新为导出时的当前配置
    cur_temp = cfg.get("temperature")
    cur_top_p = cfg.get("top_p")
    cur_pp = cfg.get("presence_penalty")
    cur_fp = cfg.get("frequency_penalty")
    cur_sp = cfg.get("system_prompt")

    if any([
        cur_temp is not None and cur_temp != agent.current_temperature,
        cur_top_p is not None and cur_top_p != agent.current_top_p,
        cur_pp is not None and cur_pp != agent.current_presence_penalty,
        cur_fp is not None and cur_fp != agent.current_frequency_penalty,
        cur_sp is not None and cur_sp != agent.current_system_prompt,
    ]):
        agent.current_system_prompt = cur_sp
        agent.current_temperature = cur_temp if cur_temp is not None else agent.current_temperature
        agent.current_top_p = cur_top_p if cur_top_p is not None else agent.current_top_p
        agent.current_presence_penalty = cur_pp if cur_pp is not None else agent.current_presence_penalty
        agent.current_frequency_penalty = cur_fp if cur_fp is not None else agent.current_frequency_penalty
        agent.thinking_enabled = cfg.get("thinking_enabled", agent.thinking_enabled)

    # 导入配置历史
    config_history = data.get("config_history", [])
    for h in config_history[:100]:
        db.add(AgentConfigHistory(
            agent_id=agent.id,
            system_prompt=h.get("system_prompt"),
            temperature=h.get("temperature", 0.8),
            top_p=h.get("top_p", 0.9),
            presence_penalty=h.get("presence_penalty", 0.5),
            frequency_penalty=h.get("frequency_penalty", 0.5),
        ))

    # 导入记忆（不生成 embedding，使用时自动生成）
    if import_memories:
        from app.services.memory_service import auto_store_memory

        memories = data.get("memories", [])
        for m in memories[:500]:
            # 直接插入，跳过 API 调用生成 embedding
            rm = RoughMemory(
                owner_type="ai",
                owner_id=agent.id,
                title=m.get("title", ""),
                scope=m.get("scope", "private"),
                group_id=m.get("group_id"),
            )
            db.add(rm)
            await db.flush()

            dm = DetailMemory(
                rough_id=rm.id,
                content=m.get("content", ""),
            )
            db.add(dm)

    logger.info(
        f"导入灵魂档案成功: agent_id={agent.id}, name={name}, "
        f"memories={len(data.get('memories', []))}, "
        f"friends=0"
    )
    return agent


def agent_to_dict(agent: Agent) -> dict:
    """将 Agent ORM 对象转为字典"""
    return {
        "id": agent.id,
        "owner_id": agent.owner_id,
        "name": agent.name,
        "original_system_prompt": agent.original_system_prompt,
        "original_temperature": agent.original_temperature,
        "original_top_p": agent.original_top_p,
        "original_presence_penalty": agent.original_presence_penalty,
        "original_frequency_penalty": agent.original_frequency_penalty,
        "current_system_prompt": agent.current_system_prompt,
        "current_temperature": agent.current_temperature,
        "current_top_p": agent.current_top_p,
        "current_presence_penalty": agent.current_presence_penalty,
        "current_frequency_penalty": agent.current_frequency_penalty,
        "chat_model": agent.chat_model,
        "work_model": agent.work_model,
        "state": agent.state,
        "offline_until": str(agent.offline_until) if agent.offline_until else None,
        "is_paused": agent.is_paused,
        "auto_dnd_threshold": agent.auto_dnd_threshold,
        "auto_dnd_duration": agent.auto_dnd_duration,
        "is_ai_editable": agent.is_ai_editable,
        "thinking_enabled": agent.thinking_enabled,
        "config_profile": agent.config_profile or "custom",
        "delay_reply_enabled": agent.delay_reply_enabled,
        "max_tool_rounds": agent.max_tool_rounds,
        "alarm_max_tool_rounds": agent.alarm_max_tool_rounds,
        "force_alarm_on_end": agent.force_alarm_on_end,
        "max_alarms": agent.max_alarms,
        "hide_ai_identity": agent.hide_ai_identity,
        "user_id": agent.user_id,
        "api_credit_cost": agent.api_credit_cost,
        "api_base_url": agent.api_base_url,
        "has_api_key": agent.api_key_encrypted is not None,
        "avatar_url": agent.avatar_url,
        "api_token": agent.api_token,
        "created_at": str(agent.created_at) if agent.created_at else None,
    }
