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
    similarity_threshold: float = 0.35,
    group_id: int | None = None,
) -> list[dict]:
    """
    检索与当前对话相关的记忆（向量相似度搜索）。

    检索范围：
    - 该 AI 的私有记忆（scope='private'）
    - 群共享记忆（scope='group'，群内任何 AI 存储的）

    返回: [{id, title, content, scope, similarity}]
    """
    from app.utils.embedding import get_embedding

    # 向量化查询
    try:
        query_embedding = await get_embedding(query, api_base_url=api_base_url, api_key=api_key)
    except Exception as e:
        logger.warning(f"记忆检索向量化失败: {e}")
        return []

    embedding_str = f"[{','.join(map(str, query_embedding))}]"

    # 检索范围：该 AI 的私有记忆 + 群内共享记忆（其他 AI 在群中存储的 group scope）
    if group_id:
        sql = text("""
            SELECT rm.id, rm.title, rm.scope,
                   1 - (rm.embedding <=> :embedding) AS similarity,
                   dm.content
            FROM rough_memories rm
            LEFT JOIN detail_memories dm ON dm.rough_id = rm.id
            WHERE rm.embedding IS NOT NULL
              AND 1 - (rm.embedding <=> :embedding) > :threshold
              AND (
                  (rm.owner_type = 'ai' AND rm.owner_id = :agent_id AND rm.scope = 'private')
                  OR
                  (rm.scope = 'group' AND rm.group_id = :group_id)
              )
            ORDER BY rm.embedding <=> :embedding
            LIMIT :top_k
        """)
        result = await db.execute(sql, {
            "embedding": embedding_str,
            "agent_id": agent_id,
            "group_id": group_id,
            "threshold": similarity_threshold,
            "top_k": top_k,
        })
    else:
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


async def auto_extract_key_facts(
    db: AsyncSession,
    agent_id: int,
    group_id: int,
    content: str,
    sender_name: str = "",
    api_base_url: str = "https://api.deepseek.com",
    api_key: str | None = None,
) -> bool:
    """
    从消息内容中自动提取关键信息并存储为记忆。

    触发条件（满足任一）：
    - 明确记忆指令：「记住」「记下」「别忘了」「提醒我」
    - 偏好表达：「我喜欢」「我不喜欢」「我讨厌」「我偏好」
    - 决定声明：「决定了」「就这样」「定下来」「确认」
    - 个人信息：「我是」「我的」「我叫」
    - 任务分配：「你来负责」「交给你」「你的任务是」

    返回: True 如果存储了记忆，False 如果跳过。
    """
    import re

    triggers = [
        (r'(记住|记下|别忘了|提醒我|记住这个)', "显式记忆请求"),
        (r'我(喜欢|不喜欢|讨厌|偏好|爱|恨)', "偏好表达"),
        (r'(决定了|就这样|定下来|确认了|说定了)', "决定"),
        (r'我(是|叫|的|在|做|从事)', "个人信息"),
        (r'(你来负责|交给你|你的任务是|你负责)', "任务分配"),
        (r'(目标|计划是|下一步|里程碑)', "目标/计划"),
    ]

    triggered_category = None
    for pattern, category in triggers:
        if re.search(pattern, content):
            triggered_category = category
            break

    if not triggered_category:
        return False

    # 生成标题（取内容前 60 字符）
    clean_content = content.strip()
    title = clean_content[:60]
    if len(clean_content) > 60:
        title += "..."

    try:
        await auto_store_memory(
            db, agent_id, group_id,
            title=f"[{triggered_category}] {title}",
            content=clean_content[:500],
            scope="private",
            api_base_url=api_base_url,
            api_key=api_key,
        )
        logger.info(f"📝 自动提取记忆成功: [{triggered_category}] {title[:50]}")
        return True
    except Exception as e:
        logger.warning(f"自动提取记忆失败: {e}")
        return False


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

    # ⚠️ 字符串内如需引用中文名词，用直角引号「」或转义 \"，严禁直接用 ""——
    #    Python 会把第二个 " 当作字符串终止符，导致 SyntaxError 全局炸（worker 崩溃、AI 不回复）
    lines.append("请参考以上记忆来个性化你的回复，但不要刻意提及「记忆库」。\n")
    return "\n".join(lines)
