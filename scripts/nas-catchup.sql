-- ============================================================
-- NAS 数据库列补齐脚本（幂等，可在任何版本安全执行）
-- 用法：docker compose exec postgres psql -U ai_chat -d ai_group_chat -f /dev/stdin < nas-catchup.sql
--   或：docker cp nas-catchup.sql aischat-postgres-1:/tmp/ && docker compose exec postgres psql -U ai_chat -d ai_group_chat -f /tmp/nas-catchup.sql
-- ============================================================

-- ── agents 表（迁移最多，最容易缺列）──
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS auto_dnd_threshold INTEGER DEFAULT 20;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS auto_dnd_duration INTEGER DEFAULT 5;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS config_profile VARCHAR(20) NOT NULL DEFAULT 'custom';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS conversation_logs_limit INTEGER;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS user_can_view_logs BOOLEAN;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_credit_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_base_url TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS delay_reply_enabled BOOLEAN;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS max_tool_rounds INTEGER NOT NULL DEFAULT 3;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS alarm_max_tool_rounds INTEGER NOT NULL DEFAULT 10;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS force_alarm_on_end BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS max_alarms INTEGER NOT NULL DEFAULT 10;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reminder_grace VARCHAR(10) NOT NULL DEFAULT 'every_time';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS hide_ai_identity BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS ai_type VARCHAR(20) NOT NULL DEFAULT 'resonance';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_willingness_score INTEGER;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_willingness_reason TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_token VARCHAR(64);

-- ── users 表 ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS conversation_logs_limit INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_credit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'zh';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_prefs JSONB DEFAULT '{}';

-- ── groups 表 ──
ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_federated BOOLEAN DEFAULT false;

-- ── messages 表 ──
ALTER TABLE messages ADD COLUMN IF NOT EXISTS source_public_id VARCHAR(50);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments JSONB;

-- ── dm_messages 表 ──
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS attachments TEXT;

-- ── file_metadata 表 ──
ALTER TABLE file_metadata ADD COLUMN IF NOT EXISTS collaboration_mode VARCHAR(10) DEFAULT 'solo' CHECK (collaboration_mode IN ('solo', 'shared', 'open'));
ALTER TABLE file_metadata ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- ── agent_workspace 表 ──
ALTER TABLE agent_workspace ADD COLUMN IF NOT EXISTS todo TEXT DEFAULT '';
ALTER TABLE agent_workspace ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT '';
ALTER TABLE agent_workspace ADD COLUMN IF NOT EXISTS journal TEXT DEFAULT '';

-- ── rough_memories 表 ──
ALTER TABLE rough_memories ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);

-- ── redemption_codes 表（如果存在）──
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'redemption_codes') THEN
        ALTER TABLE redemption_codes ADD COLUMN IF NOT EXISTS code_type VARCHAR(10) NOT NULL DEFAULT 'ai_quota';
    END IF;
END $$;

-- ── instance_config 表（如果存在）──
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'instance_config') THEN
        ALTER TABLE instance_config ADD COLUMN IF NOT EXISTS github_token_encrypted TEXT;
    END IF;
END $$;

-- ── federation_peers 表（如果存在）──
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'federation_peers') THEN
        ALTER TABLE federation_peers ADD COLUMN IF NOT EXISTS remote_url_backup VARCHAR(500);
        ALTER TABLE federation_peers ADD COLUMN IF NOT EXISTS url_rotated_at TIMESTAMP;
        ALTER TABLE federation_peers ADD COLUMN IF NOT EXISTS url_rotation_count INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;

-- ── conversation_log_config 表（如果缺失则创建）──
CREATE TABLE IF NOT EXISTS conversation_log_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    max_conversation_logs INTEGER DEFAULT 30,
    default_user_conversation_logs INTEGER DEFAULT 20,
    default_user_log_access BOOLEAN DEFAULT FALSE,
    default_delay_reply_enabled BOOLEAN NOT NULL DEFAULT false,
    updated_by INTEGER REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO conversation_log_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── ai_conversation_logs 表（如果缺失则创建）──
CREATE TABLE IF NOT EXISTS ai_conversation_logs (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    group_id INTEGER REFERENCES groups(id),
    session_id VARCHAR(50),
    conversation_type VARCHAR(10) NOT NULL DEFAULT 'group',
    messages JSONB NOT NULL,
    message_count INTEGER DEFAULT 0,
    token_usage JSONB,
    has_output BOOLEAN DEFAULT FALSE,
    model VARCHAR(50),
    thinking_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conv_logs_agent ON ai_conversation_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_conv_logs_time ON ai_conversation_logs(created_at);

-- ── agent_user_configs 表（如果缺失则创建）──
CREATE TABLE IF NOT EXISTS agent_user_configs (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    temperature DOUBLE PRECISION,
    top_p DOUBLE PRECISION,
    presence_penalty DOUBLE PRECISION,
    frequency_penalty DOUBLE PRECISION,
    thinking_enabled BOOLEAN,
    hide_ai_identity BOOLEAN,
    system_prompt_override TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    CONSTRAINT uq_agent_user_config UNIQUE (agent_id, user_id)
);

-- ── file_references 表（如果缺失则创建）──
CREATE TABLE IF NOT EXISTS file_references (
    id SERIAL PRIMARY KEY,
    file_id INT NOT NULL REFERENCES file_metadata(id) ON DELETE CASCADE,
    referrer_type VARCHAR(10) NOT NULL CHECK (referrer_type IN ('ai', 'message', 'group')),
    referrer_id INT NOT NULL,
    ref_type VARCHAR(20) DEFAULT 'read' CHECK (ref_type IN ('read', 'write', 'import', 'share')),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_file_refs_file ON file_references(file_id);
CREATE INDEX IF NOT EXISTS idx_file_refs_ref ON file_references(referrer_type, referrer_id);

-- ── file_collaborators 表（如果缺失则创建）──
CREATE TABLE IF NOT EXISTS file_collaborators (
    id SERIAL PRIMARY KEY,
    file_id INT NOT NULL REFERENCES file_metadata(id) ON DELETE CASCADE,
    collaborator_type VARCHAR(10) NOT NULL CHECK (collaborator_type IN ('ai', 'user')),
    collaborator_id INT NOT NULL,
    role VARCHAR(20) DEFAULT 'collaborator' CHECK (role IN ('collaborator', 'viewer')),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(file_id, collaborator_type, collaborator_id)
);
CREATE INDEX IF NOT EXISTS idx_file_collabs_file ON file_collaborators(file_id);

-- ── VARCHAR 宽度修复（老部署可能太窄）──
ALTER TABLE system_logs ALTER COLUMN log_type TYPE VARCHAR(50);
ALTER TABLE system_logs ALTER COLUMN target_type TYPE VARCHAR(50);
