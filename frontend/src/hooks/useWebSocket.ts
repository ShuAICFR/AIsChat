import { useEffect, useRef, useState, useCallback } from 'react'

interface WebSocketMessage {
  type: string
  data?: any
  code?: string
  message?: string
  tool_call_id?: string
}

interface WsError {
  code: string
  message: string
  tool_call_id?: string
  timestamp: number
}

export function useWebSocket(groupId: number | null) {
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)
  const [connected, setConnected] = useState(false)
  const [errors, setErrors] = useState<WsError[]>([])  // 错误列表（用于 toast）
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

  useEffect(() => {
    if (!groupId) {
      setConnected(false)
      return
    }

    const token = localStorage.getItem('access_token')
    if (!token) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/ws?token=${token}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      ws.send(JSON.stringify({ type: 'subscribe', group_id: groupId }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

        // 处理错误事件
        if (msg.type === 'error') {
          const wsError: WsError = {
            code: msg.code || 'UNKNOWN',
            message: msg.message || '未知错误',
            tool_call_id: msg.tool_call_id,
            timestamp: Date.now(),
          }
          setErrors((prev) => [...prev.slice(-9), wsError])  // 最多保留 10 条
          // 5 秒后自动清除
          setTimeout(() => {
            setErrors((prev) => prev.filter((e) => e.timestamp !== wsError.timestamp))
          }, 5000)
        }

        // 处理未读摘要
        if (msg.type === 'unread_summary') {
          setUnreadSummary(msg.data)
        }

        setLastMessage(msg)
      } catch {
        // ignore invalid JSON
      }
    }

    ws.onclose = () => {
      setConnected(false)
    }

    ws.onerror = () => {
      setConnected(false)
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [groupId])

  const sendMessage = useCallback((content: string, replyTo?: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'send',
        group_id: groupId,
        content,
        reply_to: replyTo ?? null,
      }))
    }
  }, [groupId])

  const sendTyping = useCallback((isTyping: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'typing',
        group_id: groupId,
        is_typing: isTyping,
      }))
    }
  }, [groupId])

  const clearErrors = useCallback(() => setErrors([]), [])
  const clearSummary = useCallback(() => setUnreadSummary(null), [])

  return {
    lastMessage,
    connected,
    errors,
    unreadSummary,
    sendMessage,
    sendTyping,
    clearErrors,
    clearSummary,
  }
}
