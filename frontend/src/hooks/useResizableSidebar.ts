import { useState, useCallback, useEffect, useRef } from 'react'

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 500
const SIDEBAR_DEFAULT = 320

/**
 * 可拖拽侧边栏宽度 Hook。
 * 桌面端 mousedown 拖拽手柄 → 调整宽度 → 持久化到 localStorage。
 */
export function useResizableSidebar(storageKey: string) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(storageKey)
    return saved ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(saved))) : SIDEBAR_DEFAULT
  })
  const resizing = useRef(false)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX))
      setSidebarWidth(w)
      localStorage.setItem(storageKey, String(w))
    }
    const onUp = () => {
      if (resizing.current) {
        resizing.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [storageKey])

  return { sidebarWidth, handleResizeStart }
}
