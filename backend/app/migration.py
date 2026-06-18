"""
数据库迁移脚本（幂等：每次启动自动执行，已迁移则跳过）

v1.1.2 迁移内容：
  1. users 表加 type 列（human/ai）
  2. agents 表加 user_id 列
  3. 为已有 agent 创建 users 条目（username = agent.name + "_agent"）
  4. 新建 dm_sessions / dm_messages 表
  5. 将历史 DM 群聊消息导入 dm_messages

v1.1.3 迁移内容：
  6. 新建 agent_alarms 表（AI 自主闹钟）
  7. 新建 agent_workspace 表（AI 当前任务追踪 / 中断恢复）
"""
import logging
from sqlalchemy import text, select
from app.database import async_session

logger = logging.getLogger(__name__)


async def run_migrations():
    """执行所有必要的迁移（幂等）"""
    logger.info("🔧 检查并执行数据库迁移...")

    async with async_session() as db:
        try:
            await _migrate_users_type(db)
            await _migrate_agents_user_id(db)
            await _migrate_create_dm_tables(db)
            await _migrate_agent_users(db)
            await _migrate_dm_messages(db)
            await _migrate_agent_alarms(db)
            await _migrate_workspace(db)
            await _migrate_agent_skills(db)
            await _fix_column_types(db)  # 必须是最后一个：修复老部署的列类型不匹配
            logger.info("✅ 数据库迁移检查完成")
        except Exception as e:
            await db.rollback()
            logger.error(f"❌ 数据库迁移失败: {e}", exc_info=True)
            raise


async def _column_exists(db, table: str, column: str) -> bool:
    """检查列是否存在（幂等判断）"""
    result = await db.execute(text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = :table AND column_name = :column
        )
    """), {"table": table, "column": column})
    return result.scalar()


async def _table_exists(db, table: str) -> bool:
    """检查表是否存在（幂等判断）"""
    result = await db.execute(text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = :table
        )
    """), {"table": table})
    return result.scalar()


async def _migrate_users_type(db):
    """users 表加 type 列"""
    if await _column_exists(db, "users", "type"):
        logger.info("  ⏭ users.type 已存在，跳过")
        return
    logger.info("  ➕ 添加 users.type 列")
    await db.execute(text("ALTER TABLE users ADD COLUMN type VARCHAR(10) DEFAULT 'human'"))
    await db.execute(text("UPDATE users SET type = 'human' WHERE type IS NULL"))
    await db.commit()


async def _migrate_agents_user_id(db):
    """agents 表加 user_id 列"""
    if await _column_exists(db, "agents", "user_id"):
        logger.info("  ⏭ agents.user_id 已存在，跳过")
        return
    logger.info("  ➕ 添加 agents.user_id 列")
    await db.execute(text("ALTER TABLE agents ADD COLUMN user_id INT REFERENCES users(id)"))
    await db.commit()


async def _migrate_create_dm_tables(db):
    """创建 dm_sessions / dm_messages 表"""
    if await _table_exists(db, "dm_sessions"):
        logger.info("  ⏭ dm_sessions 表已存在，跳过")
        return
    logger.info("  📦 创建 dm_sessions / dm_messages 表")
    await db.execute(text("""
        CREATE TABLE dm_sessions (
            id SERIAL PRIMARY KEY,
            session_id VARCHAR(64) UNIQUE NOT NULL,
            user1_id INT NOT NULL REFERENCES users(id),
            user2_id INT NOT NULL REFERENCES users(id),
            user1_dnd_until TIMESTAMP,
            user2_dnd_until TIMESTAMP,
            last_message_id INT,
            last_message_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user1_id, user2_id)
        )
    """))
    await db.execute(text("""
        CREATE TABLE dm_messages (
            id SERIAL PRIMARY KEY,
            session_id VARCHAR(64) NOT NULL REFERENCES dm_sessions(session_id) ON DELETE CASCADE,
            sender_id INT NOT NULL REFERENCES users(id),
            content TEXT NOT NULL,
            reply_to INT,
            read_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """))
    await db.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_dm_messages_session ON dm_messages(session_id)
    """))
    await db.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_dm_messages_created_at ON dm_messages(created_at)
    """))
    await db.commit()


async def _migrate_agent_users(db):
    """为已有 agent 创建 users 条目（幂等：检查 agent.user_id 是否为 NULL）"""
    from app.models.agent import Agent
    from app.models.user import User

    result = await db.execute(
        select(Agent).where(Agent.user_id.is_(None))
    )
    agents = result.scalars().all()

    if not agents:
        logger.info("  ⏭ 所有 agent 已有 users 条目，跳过")
        return

    logger.info(f"  👤 为 {len(agents)} 个 agent 创建 users 条目")
    for agent in agents:
        user = User(
            username=f"{agent.name}_agent",
            type="ai",
            password_hash="",
            role="ai",
            is_active=True,
        )
        db.add(user)
        await db.flush()
        agent.user_id = user.id
        logger.info(f"    agent {agent.name}({agent.id}) → user {user.id}")
    await db.commit()


async def _migrate_dm_messages(db):
    """将历史 DM 群聊消息导入 dm_messages（幂等：检查是否已有 dm_messages）"""
    from app.models.dm import DMMessage

    # 如果 dm_messages 表已有数据，跳过
    result = await db.execute(select(DMMessage).limit(1))
    if result.scalar_one_or_none():
        logger.info("  ⏭ dm_messages 已有数据，跳过历史导入")
        return

    # 查找所有 DM: 前缀的群聊
    from app.models.group import Group, GroupMember
    from app.models.message import Message
    from app.models.agent import Agent
    from app.models.user import User

    dm_groups = await db.execute(
        select(Group).where(Group.name.like("DM:%"))
    )
    dm_groups = dm_groups.scalars().all()

    if not dm_groups:
        logger.info("  ⏭ 无历史 DM 群聊，跳过消息导入")
        return

    logger.info(f"  📥 导入 {len(dm_groups)} 个历史 DM 群聊的消息...")
    imported_sessions = 0
    imported_messages = 0

    for group in dm_groups:
        # 获取两个成员
        members_result = await db.execute(
            select(GroupMember).where(GroupMember.group_id == group.id)
        )
        members = members_result.scalars().all()
        if len(members) != 2:
            continue

        # 解析两个成员的 users.id
        user_ids = []
        for m in members:
            if m.member_type == "human":
                user_ids.append(m.member_id)
            elif m.member_type == "ai":
                # 查 agent.user_id
                agent_result = await db.execute(
                    select(Agent.user_id).where(Agent.id == m.member_id)
                )
                agent_user_id = agent_result.scalar_one_or_none()
                if agent_user_id:
                    user_ids.append(agent_user_id)

        if len(user_ids) != 2:
            continue

        user_ids.sort()
        session_id = f"{user_ids[0]}_{user_ids[1]}"

        # 查找或创建 dm_session
        from app.models.dm import DMSession
        existing = await db.execute(
            select(DMSession).where(DMSession.session_id == session_id)
        )
        session = existing.scalar_one_or_none()
        if not session:
            session = DMSession(
                session_id=session_id,
                user1_id=user_ids[0],
                user2_id=user_ids[1],
            )
            db.add(session)
            await db.flush()
            imported_sessions += 1

        # 导入消息
        msgs_result = await db.execute(
            select(Message)
            .where(Message.group_id == group.id)
            .order_by(Message.created_at.asc())
        )
        group_messages = msgs_result.scalars().all()

        for msg in group_messages:
            # 确定 sender users.id
            if msg.sender_type == "human":
                sender_user_id = msg.sender_id
            elif msg.sender_type == "ai":
                agent_result = await db.execute(
                    select(Agent.user_id).where(Agent.id == msg.sender_id)
                )
                sender_user_id = agent_result.scalar_one_or_none()
                if not sender_user_id:
                    continue
            elif msg.sender_type == "system":
                # 系统消息跳过
                continue
            else:
                continue

            dm_msg = DMMessage(
                session_id=session_id,
                sender_id=sender_user_id,
                content=msg.content,
                created_at=msg.created_at,  # 保留原始时间
            )
            db.add(dm_msg)
            imported_messages += 1

    await db.commit()
    logger.info(f"  ✅ 导入完成: {imported_sessions} 个会话, {imported_messages} 条消息")


async def _migrate_agent_alarms(db):
    """创建 agent_alarms 表（v1.1.3）"""
    if await _table_exists(db, "agent_alarms"):
        logger.info("  ⏭ agent_alarms 表已存在，跳过")
        return
    logger.info("  ⏰ 创建 agent_alarms 表")
    await db.execute(text("""
        CREATE TABLE agent_alarms (
            id SERIAL PRIMARY KEY,
            agent_id INT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            wake_at TIMESTAMPTZ NOT NULL,
            task TEXT NOT NULL,
            status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'fired', 'cancelled')),
            created_at TIMESTAMP DEFAULT NOW(),
            fired_at TIMESTAMPTZ
        )
    """))
    await db.commit()
    logger.info("  ✅ agent_alarms 表创建完成")


async def _migrate_workspace(db):
    """创建 agent_workspace 表（v1.1.3）"""
    if await _table_exists(db, "agent_workspace"):
        logger.info("  ⏭ agent_workspace 表已存在，跳过")
        return
    logger.info("  📋 创建 agent_workspace 表")
    await db.execute(text("""
        CREATE TABLE agent_workspace (
            agent_id INT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
            current_task TEXT,
            current_task_at TIMESTAMP,
            interrupted_at TIMESTAMP,
            interruption_reason TEXT,
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """))
    await db.commit()
    logger.info("  ✅ agent_workspace 表创建完成")


async def _migrate_agent_skills(db):
    """创建 agent_skills 表（v1.1.5 Skill 系统）"""
    if await _table_exists(db, "agent_skills"):
        logger.info("  ⏭ agent_skills 表已存在，跳过")
        return
    logger.info("  🧠 创建 agent_skills 表")
    await db.execute(text("""
        CREATE TABLE agent_skills (
            id SERIAL PRIMARY KEY,
            agent_id INT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            name VARCHAR(100) NOT NULL,
            skill_type VARCHAR(30) NOT NULL,
            is_enabled BOOLEAN DEFAULT TRUE,
            config JSONB NOT NULL DEFAULT '{}',
            priority INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT ck_agent_skills_type CHECK (
                skill_type IN ('delay_reply', 'typing_indicator', 'scene_trigger', 'inject_prompt')
            )
        )
    """))
    await db.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills(agent_id)
    """))
    await db.commit()
    logger.info("  ✅ agent_skills 表创建完成")


async def _fix_column_types(db):
    """修复老部署中列类型与新代码不匹配的问题（幂等：按需 ALTER）"""
    # system_logs.log_type：老版本可能是 VARCHAR(10)，代码写 "add_opencli_presets"（21 字符）
    await _widen_varchar(db, "system_logs", "log_type", 50)
    # system_logs.target_type：同上
    await _widen_varchar(db, "system_logs", "target_type", 50)


async def _widen_varchar(db, table: str, column: str, target_length: int):
    """如果 VARCHAR 列小于目标长度，则 ALTER 扩展它"""
    result = await db.execute(text("""
        SELECT character_maximum_length
        FROM information_schema.columns
        WHERE table_name = :table AND column_name = :column
    """), {"table": table, "column": column})
    row = result.fetchone()
    if row is None:
        return  # 列不存在，跳过
    current = row[0]
    if current is not None and current < target_length:
        logger.info(f"  🔧 ALTER {table}.{column} VARCHAR({current}) → VARCHAR({target_length})")
        await db.execute(text(
            f'ALTER TABLE {table} ALTER COLUMN {column} TYPE VARCHAR({target_length})'
        ))
        await db.commit()

