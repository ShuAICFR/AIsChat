/** Token 数量格式化（语言感知）。
 *  - 中文 (zh)：≥1万显示为 "X.X万"，否则千分位
 *  - 英文 (en)：≥1K 显示为 "X.XK"，≥1M 显示为 "X.XM"，否则千分位
 */
export function fmtTokenNum(n: number, lang?: string): string {
  if (lang === 'en') {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return (n || 0).toLocaleString()
  }
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : (n || 0).toLocaleString()
}
