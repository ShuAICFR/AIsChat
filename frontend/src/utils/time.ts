/**
 * 相对时间格式化
 * - 今天 → HH:MM
 * - 昨天 → "昨天" / "Yesterday"
 * - 2-6 天前 → "X天前" / "X days ago"
 * - 1-4 周前 → "X周前" / "X weeks ago"
 * - >4 周前 → "YYYY/M/D"
 */
export function formatRelativeTime(
  dateStr: string | null | undefined,
  lang: 'zh' | 'en' = 'zh'
): string {
  if (!dateStr) return ''

  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  // 今天：显示时间 HH:MM
  if (diffDays === 0) {
    return date.toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // 昨天
  if (diffDays === 1) {
    return lang === 'zh' ? '昨天' : 'Yesterday'
  }

  // 2-6 天前
  if (diffDays >= 2 && diffDays <= 6) {
    return lang === 'zh' ? `${diffDays}天前` : `${diffDays} days ago`
  }

  // 1-4 周前（7-28 天）
  if (diffDays >= 7 && diffDays <= 28) {
    const weeks = Math.floor(diffDays / 7)
    return lang === 'zh' ? `${weeks}周前` : `${weeks} week${weeks > 1 ? 's' : ''} ago`
  }

  // >4 周前：YYYY/M/D
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const d = date.getDate()
  return `${y}/${m}/${d}`
}

/**
 * 格式化消息气泡内的时间（完整时间）
 */
export function formatMessageTime(
  dateStr: string | null | undefined,
  lang: 'zh' | 'en' = 'zh'
): string {
  if (!dateStr) return ''

  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  const timeStr = date.toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (diffDays === 0) {
    return timeStr
  }

  if (diffDays === 1) {
    return lang === 'zh' ? `昨天 ${timeStr}` : `Yesterday ${timeStr}`
  }

  if (diffDays >= 2 && diffDays <= 6) {
    return lang === 'zh' ? `${diffDays}天前 ${timeStr}` : `${diffDays} days ago ${timeStr}`
  }

  if (diffDays >= 7 && diffDays <= 28) {
    const weeks = Math.floor(diffDays / 7)
    const weekStr = lang === 'zh' ? `${weeks}周前` : `${weeks} week${weeks > 1 ? 's' : ''} ago`
    return `${weekStr} ${timeStr}`
  }

  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const d = date.getDate()
  return `${y}/${m}/${d} ${timeStr}`
}
