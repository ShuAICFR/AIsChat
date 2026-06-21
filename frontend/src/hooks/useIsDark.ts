import { useState, useEffect } from 'react'

/** 监听 <html> 的 dark class 变化，供图表等需要动态颜色的场景使用 */
export function useIsDark() {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'))
    check()
    const obs = new MutationObserver(check)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  return isDark
}
