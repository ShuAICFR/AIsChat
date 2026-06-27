import { useState, useCallback, useEffect, useRef } from 'react'

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 500
const SIDEBAR_DEFAULT = 320

/**
 * 可拖拽侧边栏宽度 Hook。
 * 桌面端 mousedown 拖拽手柄 → 调整宽度 → 持久化到 localStorage。
 * @param storageKey localStorage 存储键
 * @param sidebarRef 侧边栏容器 DOM ref，用于计算相对左边缘的偏移
 */
export function useResizableSidebar(storageKey: string, sidebarRef: React.RefObject<HTMLElement | null>) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(storageKey)
    return saved ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(saved))) : SIDEBAR_DEFAULT
  })
  const resizing = useRef(false)
  const sidebarLeftRef = useRef(0)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    // 记录拖拽开始时侧边栏的左边缘（相对于视口）
    if (sidebarRef.current) {
      sidebarLeftRef.current = sidebarRef.current.getBoundingClientRect().left
    } else {
      sidebarLeftRef.current = 0
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [sidebarRef])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return
      const w = Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, e.clientX - sidebarLeftRef.current)))
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
  }, [storageKey, sidebarRef])

  return { sidebarWidth, handleResizeStart }
}
