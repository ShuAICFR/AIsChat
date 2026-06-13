"""
记忆服务
自动检索相关记忆注入 prompt、自动存储关键信息
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

logger = logging.getLogger(__name__)


async def recall_relevant_memories(
    db: AsyncSession,
    agent_id: int,
    query: str,
    api_base_url: str = "https://api.deepseek.com",
    api_key: str | None = None,
    top_k: int = 5,
    similarity_threshold: float = 0.5,
) -> list[dict]:
    """
    检索与当前对话相关的记忆（向量相似度搜索）。

    返回: [{id, title, content, similarity}]
    """
    from app.utils.embedding import get_embedding

    # 向量化查询
    try:
        query_embedding = await get_embedding(query, api_base_url=api_base_url, api_key=api_key)
    except Exception as e:
        logger.warning(f"记忆检索向量化失败: {e}")
        return []

    embedding_str = f"[{','.join(map(str, query_embedding))}]"

    # 检索该 AI 的私有记忆 + 群聊记忆
    sql = text("""
        SELECT rm.id, rm.title, rm.scope,
               1 - (rm.embedding <=> :embedding) AS similarity,
               dm.content
        FROM rough_memories rm
        LEFT JOIN detail_memories dm ON dm.rough_id = rm.id
        WHERE rm.owner_type = 'ai'
          AND rm.owner_id = :agent_id
          AND rm.embedding IS NOT NULL
          AND 1 - (rm.embedding <=> :embedding) > :threshold
        ORDER BY rm.embedding <=> :embedding
        LIMIT :top_k
    """)

    result = await db.execute(sql, {
        "embedding": embedding_str,
        "agent_id": agent_id,
        "threshold": similarity_threshold,
        "top_k": top_k,
    })

    memories = []
    for row in result:
        memories.append({
            "id": row.id,
            "title": row.title,
            "scope": row.scope,
            "similarity": round(float(row.similarity), 4),
            "content": row.content or "",
        })

    if memories:
        logger.info(f"🔍 为 AI agent_id={agent_id} 检索到 {len(memories)} 条相关记忆")

    return memories


async def auto_store_memory(
    db: AsyncSession,
    agent_id: int,
    group_id: int,
    title: str,
    content: str,
    scope: str = "private",
    api_base_url: str = "https://api.deepseek.com",
    api_key: str | None = None,
) -> dict:
    """
    自动存储一条记忆（封装 embedding + rough + detail 写入）。

    返回: {"success": bool, "rough_id": int|None}
    """
    from app.models.memory import RoughMemory, DetailMemory
    from app.utils.embedding import get_embedding

    # 向量化标题
    try:
        embedding = await get_embedding(title, api_base_url=api_base_url, api_key=api_key)
    except Exception as e:
        logger.warning(f"自动记忆向量化失败: {e}")
        embedding = None

    rough = RoughMemory(
        owner_type="ai",
        owner_id=agent_id,
        title=title,
        embedding=embedding,
        scope=scope,
        group_id=group_id if scope == "group" else None,
    )
    db.add(rough)
    await db.flush()

    detail = DetailMemory(
        rough_id=rough.id,
        content=content,
    )
    db.add(detail)
    await db.flush()

    logger.info(f"💾 AI agent_id={agent_id} 自动存储记忆: {title}")
    return {"success": True, "rough_id": rough.id, "title": title}


def format_memories_for_prompt(memories: list[dict]) -> str:
    """
    将检索到的记忆格式化为可注入 prompt 的文本。

    返回: 格式化后的记忆文本，无记忆时返回空字符串。
    """
    if not memories:
        return ""

    lines = ["## 相关记忆（来自你的长期记忆库）\n"]
    for i, mem in enumerate(memories, 1):
        lines.append(f"{i}. **{mem['title']}** (相似度: {mem['similarity']})")
        if mem.get("content"):
            # 截断过长内容
            content = mem["content"]
            if len(content) > 300:
                content = content[:300] + "..."
            lines.append(f"   {content}")
        lines.append("")

    lines.append("请参考以上记忆来个性化你的回复，但不要刻意提及"记忆库"。\n")
    return "\n".join(lines)
