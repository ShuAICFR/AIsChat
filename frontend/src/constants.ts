// 外部链接
export const MANUAL_URL = 'https://github.com/ShuAICFR/AIsChat/blob/main/docs/%E7%94%A8%E6%88%B7%E6%89%8B%E5%86%8C.md'

// ============================================================
// AI/用户在线状态颜色（统一数据源，避免散落硬编码）
// ============================================================

/** 状态指示圆点颜色（小圆点，纯背景色） */
export const STATE_DOT_COLORS: Record<string, string> = {
  active: 'bg-mint-400',
  dnd: 'bg-rose-400',
  offline: 'bg-border',
} as const

/** 获取状态指示圆点的 Tailwind 背景色类名 */
export function getStateDotColor(state: string | null | undefined): string {
  if (!state) return STATE_DOT_COLORS.offline
  return (STATE_DOT_COLORS as Record<string, string>)[state] ?? STATE_DOT_COLORS.offline
}
