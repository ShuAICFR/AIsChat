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

    # 1. System prompt（基础）
    system_prompt = agent.current_system_prompt or (
        f"你是 {agent.name}，一个 AI 群聊参与者。请自然地参与对话，"
        "可以调用工具来发送消息、存储记忆、切换状态等。"
    )

    # 1b. 先获取最近消息片段，用作记忆检索的查询
    recent_for_query = await get_recent_messages(db, group_id, limit=5)
    query_text = " ".join([m.content[:200] for m in recent_for_query if m.content])

    # 1c. 注入相关记忆（用最近消息内容作为检索查询）
    if query_text.strip():
        try:
            from app.services.memory_service import recall_relevant_memories, format_memories_for_prompt
            memories = await recall_relevant_memories(
                db, agent.id,
                query=query_text,
                api_base_url=api_base_url or "https://api.deepseek.com",
                api_key=api_key,
                top_k=5,
            )
            if memories:
                memory_text = format_memories_for_prompt(memories)
                system_prompt = system_prompt + "\n\n" + memory_text
        except Exception as e:
            logger.warning(f"记忆注入失败（非致命）: {e}")

    # 鼓励 AI 使用 store_memory 工具
    system_prompt += (
        "\n\n你有 store_memory 工具，可以在对话中遇到值得记住的信息时主动存储。"
        "存储标题应简洁概括内容，内容应包含关键细节。"
    )

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
                "content": f"{name}: {content}" if role == "user" else content,
            })

    return messages
