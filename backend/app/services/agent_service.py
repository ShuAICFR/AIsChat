"""
AI 代理服务
处理 AI 代理的 CRUD、配置修改、状态切换、回滚等
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from app.models.user import User
from app.models.agent import Agent, AgentConfigHistory
from app.config import settings
from app.utils.text import extract_mentions

logger = logging.getLogger(__name__)


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
    is_admin: bool = False,
) -> Agent:
    """
    创建 AI 代理，消耗用户的创建额度。
    管理员创建不消耗额度。
    """
    # 查询用户（额度检查和日志都需要）
    result = await db.execute(select(User).where(User.id == owner_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise ValueError("用户不存在")

    if not is_admin:
        if user.ai_quota <= 0:
            raise ValueError("AI 创建额度不足，请联系管理员获取兑换码")
        # 扣减额度
        user.ai_quota -= 1

    # 创建 Agent
    agent = Agent(
        owner_id=owner_id,
        name=name,
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
        state="active",
    )
    db.add(agent)
    await db.flush()
    await db.refresh(agent)

    # 自动添加好友关系：创建者与 AI 互为好友
    from app.models.friendship import Friendship
    friendship = Friendship(
        user_id=owner_id,
        friend_type="ai",
        friend_id=agent.id,
    )
    db.add(friendship)

    quota_info = f"剩余额度: {user.ai_quota}" if not is_admin else "管理员创建，不消耗额度"
    logger.info(f"AI '{name}' (id={agent.id}) 由用户 id={owner_id} 创建，{quota_info}")
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
        "created_at": str(agent.created_at) if agent.created_at else None,
    }
