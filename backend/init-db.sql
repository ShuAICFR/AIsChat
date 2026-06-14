-- AI群聊社交网络 - 数据库初始化脚本
-- 此脚本由 PostgreSQL 容器首次启动时自动执行

-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- 用户表
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user',
    is_active BOOLEAN DEFAULT TRUE,
    ai_quota INT DEFAULT 3,
    -- 策略模式设置
    auto_approve_vector_timeout INT DEFAULT 60,
    auto_approve_vector_default BOOLEAN DEFAULT FALSE,
    -- API 配置（加密存储）
    api_base_url TEXT,
    api_key_encrypted TEXT,
    timezone VARCHAR(50) DEFAULT 'Asia/Shanghai',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- AI 代理表
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    owner_id INT REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    original_system_prompt TEXT,
    original_temperature FLOAT DEFAULT 0.8,
    original_top_p FLOAT DEFAULT 0.9,
    original_presence_penalty FLOAT DEFAULT 0.5,
    original_frequency_penalty FLOAT DEFAULT 0.5,
    current_system_prompt TEXT,
    current_temperature FLOAT,
    current_top_p FLOAT,
    current_presence_penalty FLOAT,
    current_frequency_penalty FLOAT,
    chat_model VARCHAR(50),
    work_model VARCHAR(50),
    state VARCHAR(20) DEFAULT 'active',
    offline_until TIMESTAMP,
    is_ai_editable BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- AI 配置历史表
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_config_history (
    id SERIAL PRIMARY KEY,
    agent_id INT REFERENCES agents(id) ON DELETE CASCADE,
    system_prompt TEXT,
    temperature FLOAT,
    top_p FLOAT,
    presence_penalty FLOAT,
    frequency_penalty FLOAT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 群聊表
-- ============================================================
CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    owner_type VARCHAR(10) CHECK (owner_type IN ('human', 'ai')),
    owner_id INT,
    is_vector_accelerated BOOLEAN DEFAULT FALSE,
    announcement TEXT,
    announcement_updated_at TIMESTAMP,
    speak_limit_per_minute INT DEFAULT 0,
    speak_limit_window_seconds INT DEFAULT 120,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 群成员表（多态关联）
-- ============================================================
CREATE TABLE IF NOT EXISTS group_members (
    group_id INT REFERENCES groups(id) ON DELETE CASCADE,
    member_type VARCHAR(10) CHECK (member_type IN ('human', 'ai')),
    member_id INT,
    role VARCHAR(20) DEFAULT 'member',
    dnd_until TIMESTAMP,
    last_read_at TIMESTAMP,
    joined_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (group_id, member_type, member_id)
);

-- ============================================================
-- 消息表
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    group_id INT REFERENCES groups(id) ON DELETE CASCADE,
    sender_type VARCHAR(10) CHECK (sender_type IN ('human', 'ai')),
    sender_id INT,
    content TEXT NOT NULL,
    reply_to INT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 向量加速消息表（维度 1536，自动检测后可能调整）
-- ============================================================
CREATE TABLE IF NOT EXISTS group_message_embeddings (
    id SERIAL PRIMARY KEY,
    group_id INT REFERENCES groups(id) ON DELETE CASCADE,
    message_id INT REFERENCES messages(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMP DEFAULT NOW(),
    metadata JSONB
);

-- ============================================================
-- 两层记忆表
-- ============================================================
CREATE TABLE IF NOT EXISTS rough_memories (
    id SERIAL PRIMARY KEY,
    owner_type VARCHAR(10) CHECK (owner_type IN ('ai', 'group')),
    owner_id INT,
    title VARCHAR(200) NOT NULL,
    embedding vector(1536),
    scope VARCHAR(10) DEFAULT 'private',
    group_id INT NULL REFERENCES groups(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS detail_memories (
    id SERIAL PRIMARY KEY,
    rough_id INT REFERENCES rough_memories(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 向量加速申请
-- ============================================================
CREATE TABLE IF NOT EXISTS vector_acceleration_requests (
    id SERIAL PRIMARY KEY,
    group_id INT REFERENCES groups(id) ON DELETE CASCADE,
    requester_id INT REFERENCES agents(id),
    status VARCHAR(20) DEFAULT 'pending',
    approver_type VARCHAR(10),
    approver_id INT,
    auto_handled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

-- ============================================================
-- 文件元数据
-- ============================================================
CREATE TABLE IF NOT EXISTS file_metadata (
    id SERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    owner_type VARCHAR(10) CHECK (owner_type IN ('ai', 'group', 'system')),
    owner_id INT,
    size BIGINT,
    mime_type VARCHAR(100),
    permissions JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 兑换码
-- ============================================================
CREATE TABLE IF NOT EXISTS redemption_codes (
    code VARCHAR(32) PRIMARY KEY,
    quota_amount INT NOT NULL,
    expires_at TIMESTAMP,
    used_by INT NULL REFERENCES users(id),
    used_at TIMESTAMP,
    created_by INT REFERENCES users(id)
);

-- ============================================================
-- OpenCLI 权限配置与日志
-- ============================================================
CREATE TABLE IF NOT EXISTS opencli_config (
    id INT PRIMARY KEY DEFAULT 1,
    global_enabled BOOLEAN DEFAULT FALSE,
    default_rate_limit_per_minute INT DEFAULT 5,
    timeout_seconds INT DEFAULT 30,
    updated_by INT REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opencli_agent_whitelist (
    agent_id INT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT FALSE,
    rate_limit_override INT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opencli_command_whitelist (
    id SERIAL PRIMARY KEY,
    pattern VARCHAR(200) NOT NULL,
    is_regex BOOLEAN DEFAULT FALSE,
    description VARCHAR(200),
    enabled BOOLEAN DEFAULT TRUE,
    created_by INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opencli_usage_log (
    id SERIAL PRIMARY KEY,
    agent_id INT REFERENCES agents(id) ON DELETE SET NULL,
    command TEXT NOT NULL,
    args TEXT,
    exit_code INT,
    stdout_truncated TEXT,
    stderr_truncated TEXT,
    duration_ms INT,
    executed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opencli_denied_commands (
    pattern VARCHAR(200) PRIMARY KEY,
    reason VARCHAR(200)
);

-- ============================================================
-- 好友系统
-- ============================================================
CREATE TABLE IF NOT EXISTS friendships (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    friend_type VARCHAR(10) NOT NULL CHECK (friend_type IN ('human', 'ai')),
    friend_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, friend_type, friend_id)
);

CREATE TABLE IF NOT EXISTS friendship_requests (
    id SERIAL PRIMARY KEY,
    requester_id INT NOT NULL,
    target_type VARCHAR(10) NOT NULL CHECK (target_type IN ('human', 'ai')),
    target_id INT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

-- ============================================================
-- 消息暂存（AI 离线/免打扰期间积压）
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_messages (
    id SERIAL PRIMARY KEY,
    agent_id INT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    group_id INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 未读摘要缓存
-- ============================================================
CREATE TABLE IF NOT EXISTS unread_summary_cache (
    id SERIAL PRIMARY KEY,
    agent_id INT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    group_id INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    summary_text TEXT NOT NULL,
    message_count INT,
    last_message_at TIMESTAMP,
    cached_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

-- ============================================================
-- 系统日志
-- ============================================================
CREATE TABLE IF NOT EXISTS system_logs (
    id SERIAL PRIMARY KEY,
    log_type VARCHAR(50),
    operator_type VARCHAR(10),
    operator_id INT,
    target_type VARCHAR(10),
    target_id INT,
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_rough_memories_owner ON rough_memories(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_path ON file_metadata(path);
CREATE INDEX IF NOT EXISTS idx_system_logs_type ON system_logs(log_type);
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at);
