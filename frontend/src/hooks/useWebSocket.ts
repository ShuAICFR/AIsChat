import { useEffect, useRef, useState, useCallback } from 'react'

interface WebSocketMessage {
  type: string
  data?: any
  code?: string
  message?: string
  tool_call_id?: string
  conversation_type?: string
}

interface WsError {
  code: string
  message: string
  tool_call_id?: string
  timestamp: number
}

/** 重连参数 */
const RECONNECT_BASE_MS = 1000      // 首次重连等待 1s
const RECONNECT_MAX_MS = 30_000     // 最大 30s
const RECONNECT_MULTIPLIER = 2      // 每次翻倍

/** 计算重连延迟：指数退避 + ±30% 抖动 */
function calcReconnectDelay(retryCount: number): number {
  const base = Math.min(
    RECONNECT_BASE_MS * Math.pow(RECONNECT_MULTIPLIER, retryCount),
    RECONNECT_MAX_MS,
  )
  const jitter = base * 0.3 * (Math.random() * 2 - 1)
  return Math.round(base + jitter)
}

export function useWebSocket(
  conversationType: 'group' | 'dm',
  conversationId: number | string | null,
) {
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [errors, setErrors] = useState<WsError[]>([])
  const [unreadSummary, setUnreadSummary] = useState<{
    groups: Array<{
      group_id: number
      group_name: string
      unread_count: number
      last_message_preview: string
      last_message_at: string | null
    }>
  } | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // 重连控制 ref
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  /** 建立 WebSocket 连接，返回清理函数 */
  const connect = useCallback(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return () => {}

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/ws?token=${token}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close()
        return
      }
      setConnected(true)
      setReconnecting(false)
      retryCountRef.current = 0

      // 订阅当前对话
      if (conversationType === 'group') {
        ws.send(JSON.stringify({ type: 'subscribe', group_id: conversationId }))
      } else {
        ws.send(JSON.stringify({ type: 'subscribe', session_id: conversationId }))
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

        // 错误事件：自动消失的 toast
        if (msg.type === 'error') {
          const wsError: WsError = {
            code: msg.code || 'UNKNOWN',
            message: msg.message || '未知错误',
            tool_call_id: msg.tool_call_id,
            timestamp: Date.now(),
          }
          setErrors((prev) => [...prev.slice(-9), wsError])
          setTimeout(() => {
            setErrors((prev) => prev.filter((e) => e.timestamp !== wsError.timestamp))
          }, 5000)
        }

        // 未读摘要（sidebar 用）
        if (msg.type === 'unread_summary') {
          setUnreadSummary(msg.data)
        }

        setLastMessage(msg)
      } catch {
        // ignore invalid JSON
      }
    }

    ws.onclose = (event) => {
      // 1000=正常关闭, 1001=离开页面 → 不重连
      const cleanClose = event.code === 1000 || event.code === 1001
      if (!mountedRef.current || cleanClose) {
        setConnected(false)
        setReconnecting(false)
        return
      }
      // 非正常关闭 → 调度重连
      setConnected(false)
      scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose 会紧接着触发，连接状态由 onclose 统一处理
    }

    return () => {
      // 清理：干净关闭，不触发重连
      ws.onclose = null
      ws.close(1000)
      wsRef.current = null
    }
  }, [conversationType, conversationId])

  // ── 调度重连 ──
  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return

    // 取消已有重连定时器
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    setReconnecting(true)
    retryCountRef.current += 1

    const delay = calcReconnectDelay(retryCountRef.current)
    console.log(
      `🔌 WebSocket 将在 ${(delay / 1000).toFixed(1)}s 后重连（第 ${retryCountRef.current} 次）`,
    )

    retryTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return
      connect()
      // 如果 connect 同步失败（如 token 丢失），清除重连状态
      if (!wsRef.current) setReconnecting(false)
    }, delay)
  }, [connect])

  // ── 浏览器恢复在线时立即重连 ──
  useEffect(() => {
    const handleOnline = () => {
      if (!mountedRef.current) return
      if (
        wsRef.current?.readyState !== WebSocket.OPEN &&
        wsRef.current?.readyState !== WebSocket.CONNECTING
      ) {
        console.log('🌐 浏览器恢复在线，立即重连 WebSocket')
        // 取消正在等待的重连定时器
        if (retryTimerRef.current !== null) {
          clearTimeout(retryTimerRef.current)
          retryTimerRef.current = null
        }
        retryCountRef.current = 0
        connect()
        if (!wsRef.current) setReconnecting(false)
      }
    }

    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [connect])

  // ── 主 effect：对话参数变化时重连 ──
  useEffect(() => {
    mountedRef.current = true

    // 对话切换 → 重置状态
    clearRetryTimer()
    retryCountRef.current = 0
    setConnected(false)
    setReconnecting(false)
    setLastMessage(null)

    if (!conversationId) {
      return () => { mountedRef.current = false }
    }

    const token = localStorage.getItem('access_token')
    if (!token) {
      return () => { mountedRef.current = false }
    }

    const cleanup = connect()

    return () => {
      mountedRef.current = false
      clearRetryTimer()
      if (cleanup) cleanup()
    }
  }, [conversationType, conversationId, connect])

  const sendMessage = useCallback((content: string, replyTo?: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const payload: any = {
        type: 'send',
        content,
        reply_to: replyTo ?? null,
      }
      if (conversationType === 'group') {
        payload.group_id = conversationId
      } else {
        payload.session_id = conversationId
      }
      wsRef.current.send(JSON.stringify(payload))
    }
  }, [conversationType, conversationId])

  const sendTyping = useCallback((isTyping: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const payload: any = {
        type: 'typing',
        is_typing: isTyping,
      }
      if (conversationType === 'group') {
        payload.group_id = conversationId
      } else {
        payload.session_id = conversationId
      }
      wsRef.current.send(JSON.stringify(payload))
    }
  }, [conversationType, conversationId])

  const clearErrors = useCallback(() => setErrors([]), [])
  const clearSummary = useCallback(() => setUnreadSummary(null), [])

  // 内联工具函数（仅操作 ref，不需要 useCallback）
  function clearRetryTimer() {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }

  return {
    lastMessage,
    connected,
    reconnecting,
    errors,
    unreadSummary,
    sendMessage,
    sendTyping,
    clearErrors,
    clearSummary,
  }
}
