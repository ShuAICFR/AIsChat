// 用户手册（内部路由，React 页面渲染而非直接打开 .md 文件）
export const MANUAL_URL = '/manual'
// 开发与管理者手册（直接打开 .md 文件）
export const ADMIN_MANUAL_URL = '/docs/开发与管理者手册.md'

// ============================================================
// AI/用户在线状态颜色（统一数据源，避免散落硬编码）
// ============================================================

/** 状态指示圆点颜色（小圆点，纯背景色） */
export const STATE_DOT_COLORS: Record<string, string> = {
  active: 'bg-mint-400',
  dnd: 'bg-rose-400',
  offline: 'bg-border',
}

/** 获取状态指示圆点的 Tailwind 背景色类名 */
export function getStateDotColor(state: string | null | undefined): string {
  if (!state) return STATE_DOT_COLORS.offline
  return STATE_DOT_COLORS[state] ?? STATE_DOT_COLORS.offline
}

/** 状态徽章颜色（背景+文字+边框组合，用于卡片/列表标签） */
export const STATE_BADGE_COLORS: Record<string, string> = {
  active: 'bg-mint-400/15 text-mint-400 border-mint-400/30',
  dnd: 'bg-rose-400/15 text-rose-400 border-rose-400/30',
  offline: 'bg-border text-textSecondary border-border/30',
  blocked: 'bg-accent-400/15 text-accent-400 border-accent-400/30',
}

// ============================================================
// AI 类型标签（统一数据源，避免 AgentsPage / MePage 重复定义）
// ============================================================

/** AI 类型 → i18n 键名 + Tailwind 颜色 */
export const AI_TYPE_LABEL: Record<string, { key: string; cls: string }> = {
  resonance: { key: 'aiType.resonance', cls: 'bg-violet-500/10 text-violet-400' },
  general: { key: 'aiType.general', cls: 'bg-primary-500/10 text-primary-400' },
  semi_general: { key: 'aiType.semiGeneral', cls: 'bg-amber-500/10 text-amber-400' },
}
