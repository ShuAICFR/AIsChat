/** Token 数量格式化：≥1万显示为 "X.X万"，否则千分位 */
export function fmtTokenNum(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : (n || 0).toLocaleString()
}
