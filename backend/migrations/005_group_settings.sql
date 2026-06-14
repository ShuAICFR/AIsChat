-- ============================================================
-- 迁移 005: 群聊治理功能
-- 添加群公告、发言限制、成员最后阅读时间
-- ============================================================
BEGIN;

-- groups 表：公告 + 发言限制
ALTER TABLE groups ADD COLUMN IF NOT EXISTS announcement TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS announcement_updated_at TIMESTAMP;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS speak_limit_per_minute INT DEFAULT 0;   -- 0 = 不限制
ALTER TABLE groups ADD COLUMN IF NOT EXISTS speak_limit_window_seconds INT DEFAULT 120; -- 时间窗口

-- group_members 表：免打扰截止时间 + 最后阅读时间
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS dnd_until TIMESTAMP;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP;

COMMIT;
