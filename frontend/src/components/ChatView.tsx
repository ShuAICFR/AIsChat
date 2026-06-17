import { useState, useEffect, useRef, useCallback } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import MessageBubble from './MessageBubble'
import ProfileCard from './ProfileCard'
import { Send, Loader2, AlertTriangle, X, ArrowDown, ArrowUp } from 'lucide-react'

interface Message {
  id: number
  group_id?: number
  session_id?: string
  sender_type: string
  sender_id: number
  sender_name: string | null
  content: string
  reply_to: number | null
  read_at?: string | null
  created_at: string
}

interface ChatViewProps {
  conversationType: 'group' | 'dm'
  conversationId: number | string
}

const PAGE_SIZE = 20

export default function ChatView({ conversationType, conversationId }: ChatViewProps) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loadingState, setLoadingState] = useState<'initial' | 'older' | 'newer' | null>(null)
  const [hasMoreBefore, setHasMoreBefore] = useState(false)
  const [hasMoreAfter, setHasMoreAfter] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [firstUnreadId, setFirstUnreadId] = useState<number | null>(null)
  const [showJumpToUnread, setShowJumpToUnread] = useState(false)
  const [profileCard, setProfileCard] = useState<{
    type: string; id: number; name: string; state?: string
  } | null>(null)
  const [thinkingAgents, setThinkingAgents] = useState<Map<number, string>>(new Map())
  // @提及 自动补全（仅群聊）
  const [groupMembers, setGroupMembers] = useState<Array<{ type: string; id: number; name: string; state?: string }>>([])
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const bottomSentinelRef = useRef<HTMLDivElement>(null)
  const firstUnreadRef = useRef<HTMLDivElement>(null)
  const prevMessageCount = useRef(0)
  const isAutoScrolling = useRef(false)
  const prevScrollHeight = useRef(0)
  const isAtBottomRef = useRef(true)
  const newestIdRef = useRef<number | null>(null)       // 离开时保存已读位置
  const oldestIdRef = useRef<number | null>(null)        // 供哨兵读取，避免 messages 依赖
  const showJumpToUnreadRef = useRef(false)              // 避免 scroll 中高频 setState

  // 离开对话时保存已读位置（通过 newestIdRef，无需额外的 messages 同步 effect）
  useEffect(() => {
    return () => {
      if (newestIdRef.current && conversationId) {
        const key = `lastRead_${conversationType}_${conversationId}`
        localStorage.setItem(key, String(newestIdRef.current))
      }
    }
  }, [conversationId, conversationType])

  const { lastMessage, connected, reconnecting, errors, sendMessage, sendTyping, clearErrors } = useWebSocket(conversationType, conversationId)

  // ============================================================
  // 消息加载器
  // ============================================================

  const loadMessages = useCallback(async (params: {
    before_id?: number
    after_id?: number
    mode: 'initial' | 'older' | 'newer'
  }) => {
    const { before_id, after_id, mode } = params
    // 避免 initial 模式重复设值（调用方已设过）
    if (mode !== 'initial') setLoadingState(mode)

    // 加载旧消息前记录当前滚动高度
    if (mode === 'older' && containerRef.current) {
      prevScrollHeight.current = containerRef.current.scrollHeight
    }

    try {
      const queryParams = new URLSearchParams()
      queryParams.set('limit', String(PAGE_SIZE))
      if (before_id) queryParams.set('before_id', String(before_id))
      if (after_id) queryParams.set('after_id', String(after_id))

      let fetched: Message[]
      if (conversationType === 'group') {
        fetched = await api.get<Message[]>(
          `/groups/${conversationId}/messages?${queryParams.toString()}`
        )
      } else {
        fetched = await api.get<Message[]>(
          `/dm/${conversationId}/messages?${queryParams.toString()}`
        )
      }

      const gotFullPage = fetched.length >= PAGE_SIZE

      // 更新 refs（避免 IntersectionObserver 依赖 messages 数组）
      if (fetched.length > 0) {
        newestIdRef.current = fetched[fetched.length - 1].id
        oldestIdRef.current = fetched[0].id
      }

      setMessages((prev) => {
        if (mode === 'older') {
          return [...fetched, ...prev]
        } else if (mode === 'newer') {
          // 游标 after_id 保证不重叠，直接拼接
          return [...prev, ...fetched]
        } else {
          return fetched
        }
      })

      if (mode === 'older') {
        setHasMoreBefore(gotFullPage)
        if (!gotFullPage) setFirstUnreadId(null)
        // 恢复滚动位置：旧消息插入头部后，补偿新增高度
        requestAnimationFrame(() => {
          if (containerRef.current && prevScrollHeight.current > 0) {
            const newHeight = containerRef.current.scrollHeight
            containerRef.current.scrollTop += (newHeight - prevScrollHeight.current)
            prevScrollHeight.current = 0
          }
        })
      } else if (mode === 'newer') {
        setHasMoreAfter(gotFullPage)
      } else {
        // initial
        setHasMoreBefore(gotFullPage)
        setHasMoreAfter(false)

        if (fetched.length > 0) {
          const key = `lastRead_${conversationType}_${conversationId}`
          const stored = localStorage.getItem(key)
          const lastReadId = stored ? parseInt(stored) : null

          if (lastReadId && lastReadId > 0) {
            // 上次已读过的对话：找第一条 > lastReadId 的消息作为"首个未读"
            const firstUnread = fetched.find(m => m.id > lastReadId)
            if (firstUnread) {
              setFirstUnreadId(firstUnread.id)
            }
            // 所有消息都已读 → firstUnreadId 保持 null
          } else if (gotFullPage) {
            // 首次访问且有更多历史消息 → 最旧那条作为未读边界
            setFirstUnreadId(fetched[0].id)
          }
          // 首次访问且消息 ≤ PAGE_SIZE → 全部可见，无需未读标记
        }
      }
    } catch (err) {
      console.error('加载消息失败:', err)
    } finally {
      setLoadingState(null)
    }
  }, [conversationId, conversationType])

  // ============================================================
  // 滚动辅助
  // ============================================================

  const scrollToBottom = useCallback((smooth = true) => {
    const el = containerRef.current
    if (!el) return
    isAutoScrolling.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' })
    setTimeout(() => { isAutoScrolling.current = false }, 500)
  }, [])

  const scrollToMessage = useCallback((messageId: number) => {
    const el = containerRef.current
    if (!el) return
    const msgEl = el.querySelector(`[data-message-id="${messageId}"]`)
    if (msgEl) {
      isAutoScrolling.current = true
      msgEl.scrollIntoView({ block: 'start', behavior: 'smooth' })
      setTimeout(() => { isAutoScrolling.current = false }, 500)
    }
  }, [])

  const handleJumpToUnread = useCallback(async () => {
    if (!firstUnreadId) return
    // 加载 firstUnreadId 之前的一页消息
    await loadMessages({ before_id: firstUnreadId, mode: 'older' })
    // 滚动到原来的 firstUnreadId 位置
    setTimeout(() => scrollToMessage(firstUnreadId), 200)
  }, [firstUnreadId, loadMessages, scrollToMessage])

  // ============================================================
  // 初始加载
  // ============================================================

  useEffect(() => {
    if (!conversationId) return
    setThinkingAgents(new Map())
    setMessages([])
    setHasMoreBefore(false)
    setHasMoreAfter(false)
    setFirstUnreadId(null)
    setShowJumpToUnread(false)
    setIsAtBottom(true)
    prevMessageCount.current = 0
    setLoadingState('initial')

    const init = async () => {
      try {
        if (conversationType === 'group') {
          api.post(`/groups/${conversationId}/read`)
            .then(() => {
              window.dispatchEvent(new CustomEvent('chat-refresh', { detail: { type: 'unread_update' } }))
            })
            .catch(() => {})
          const membersData = await api.get(`/groups/${conversationId}/members`)
          setGroupMembers(membersData)
        }
        await loadMessages({ mode: 'initial' })
        // DM 消息加载同时标记已读，触发 sidebar 刷新未读计数
        if (conversationType === 'dm') {
          window.dispatchEvent(new CustomEvent('chat-refresh', { detail: { type: 'unread_update' } }))
        }
      } catch (err) {
        console.error('初始化失败:', err)
      }
    }
    init()
  }, [conversationId, conversationType])

  // 初始加载后定位 + 立即保存已读位置（不等卸载，防止刷新时红线残留）
  useEffect(() => {
    if (loadingState === null && messages.length > 0 && prevMessageCount.current === 0) {
      prevMessageCount.current = messages.length
      // 立即保存已读位置：初始加载完成即视为用户已看到最新消息
      if (newestIdRef.current && conversationId) {
        const key = `lastRead_${conversationType}_${conversationId}`
        localStorage.setItem(key, String(newestIdRef.current))
      }
      setTimeout(() => {
        const container = containerRef.current
        if (!container) return
        if (firstUnreadId) {
          // 有更早的未读消息 → 将首个未读定位到视口顶部
          const msgEl = container.querySelector(`[data-message-id="${firstUnreadId}"]`)
          if (msgEl) {
            isAutoScrolling.current = true
            const containerRect = container.getBoundingClientRect()
            const msgRect = msgEl.getBoundingClientRect()
            container.scrollTop = container.scrollTop + msgRect.top - containerRect.top
            setTimeout(() => { isAutoScrolling.current = false }, 500)
          }
        } else if (container.scrollHeight > container.clientHeight) {
          // 无旧消息但内容溢出 → 滚到底部
          scrollToBottom(false)
        }
        // 内容不溢出 → 不滚动
      }, 100)
    }
  }, [loadingState, messages.length, firstUnreadId])

  // ============================================================
  // WebSocket 消息处理
  // ============================================================

  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.type === 'message') {
      const msg = lastMessage.data
      setMessages((prev) => {
        const next = [...prev, msg]
        newestIdRef.current = msg.id
        return next
      })
      // 如果当前在底部，自动滚到底部（用 ref 避免闭包陈旧）
      if (isAtBottomRef.current) {
        setTimeout(() => scrollToBottom(true), 50)
      }
      if (msg.sender_type === 'ai' && msg.sender_id) {
        setThinkingAgents((prev) => {
          const next = new Map(prev)
          next.delete(msg.sender_id)
          return next
        })
      }
    } else if (lastMessage.type === 'ai_thinking') {
      const d = lastMessage.data
      const thinkingBelongsToHere =
        (conversationType === 'group' && d.group_id === conversationId) ||
        (conversationType === 'dm' && d.session_id === conversationId)
      if (!thinkingBelongsToHere) return
      setThinkingAgents((prev) => {
        const next = new Map(prev)
        next.set(d.agent_id, d.agent_name)
        return next
      })
    } else if (lastMessage.type === 'ai_thinking_end') {
      const d = lastMessage.data
      const endBelongsToHere =
        (conversationType === 'group' && d.group_id === conversationId) ||
        (conversationType === 'dm' && d.session_id === conversationId)
      if (!endBelongsToHere) return
      setThinkingAgents((prev) => {
        const next = new Map(prev)
        next.delete(d.agent_id)
        return next
      })
    } else if (lastMessage.type === 'announcement') {
      const d = lastMessage.data
      if (d.group_id !== conversationId) return
      setMessages((prev) => [...prev, {
        id: -Date.now(),
        sender_type: 'system',
        sender_id: 0,
        sender_name: '📢 群公告',
        content: d.content,
        reply_to: null,
        created_at: new Date().toISOString(),
      } as Message])
    } else if (lastMessage.type === 'dm_notification' || lastMessage.type === 'unread_update') {
      window.dispatchEvent(new CustomEvent('chat-refresh', { detail: lastMessage }))
    }
  }, [lastMessage])

  // ============================================================
  // 共享哨兵 Hook：IntersectionObserver 用 ref 读取消息 ID，避免 messages 数组依赖
  // ============================================================

  function useSentinel(
    sentinelRef: React.RefObject<HTMLDivElement | null>,
    hasMore: boolean,
    direction: 'older' | 'newer',
  ) {
    useEffect(() => {
      const sentinel = sentinelRef.current
      if (!sentinel) return
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !loadingState) {
            const cursorId = direction === 'older' ? oldestIdRef.current : newestIdRef.current
            if (cursorId) {
              loadMessages(
                direction === 'older'
                  ? { before_id: cursorId, mode: 'older' }
                  : { after_id: cursorId, mode: 'newer' }
              )
            }
          }
        },
        { root: containerRef.current, threshold: 0.1 }
      )
      observer.observe(sentinel)
      return () => observer.disconnect()
    }, [hasMore, loadingState, direction])
  }

  useSentinel(topSentinelRef, hasMoreBefore, 'older')
  useSentinel(bottomSentinelRef, hasMoreAfter, 'newer')

  // ============================================================
  // 滚动监听：isAtBottom + showJumpToUnread（使用 rAF 节流 DOM 查询）
  // ============================================================

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let rafId = 0
    const handleScroll = () => {
      if (isAutoScrolling.current) return
      if (rafId) return // 上一帧的 DOM 查询尚未执行，跳过
      rafId = requestAnimationFrame(() => {
        rafId = 0
        const { scrollTop, scrollHeight, clientHeight } = container
        const atBottom = scrollHeight - scrollTop - clientHeight < 80
        setIsAtBottom(atBottom)
        isAtBottomRef.current = atBottom

        if (firstUnreadId) {
          const msgEl = container.querySelector(`[data-message-id="${firstUnreadId}"]`)
          const visible = msgEl
            ? msgEl.getBoundingClientRect().bottom >= container.getBoundingClientRect().top
            : false
          // 仅值变化时才触发渲染
          if (visible !== showJumpToUnreadRef.current) {
            showJumpToUnreadRef.current = !visible
            setShowJumpToUnread(!visible)
          }
        }
      })
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [firstUnreadId])

  // ============================================================
  // @提及逻辑（仅群聊）
  // ============================================================

  const mentionFiltered = mentionQuery
    ? groupMembers.filter((m) => m.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : groupMembers

  const detectMention = (value: string, cursorPos: number) => {
    if (conversationType === 'dm') return
    const beforeCursor = value.slice(0, cursorPos)
    const atIdx = beforeCursor.lastIndexOf('@')
    if (atIdx === -1) { setMentionActive(false); return }
    if (atIdx > 0 && beforeCursor[atIdx - 1] !== ' ') { setMentionActive(false); return }
    const query = beforeCursor.slice(atIdx + 1, cursorPos)
    if (query.includes(' ')) { setMentionActive(false); return }
    setMentionQuery(query)
    setMentionIdx(0)
    setMentionActive(true)
  }

  const insertMention = (name: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const value = input
    const cursorPos = ta.selectionStart
    const beforeCursor = value.slice(0, cursorPos)
    const atIdx = beforeCursor.lastIndexOf('@')
    if (atIdx === -1) return
    const newBefore = beforeCursor.slice(0, atIdx) + '@' + name + ' '
    const newValue = newBefore + value.slice(cursorPos)
    setInput(newValue)
    setMentionActive(false)
    requestAnimationFrame(() => {
      ta.focus()
      const newPos = newBefore.length
      ta.setSelectionRange(newPos, newPos)
    })
  }

  const handleSend = () => {
    if (!input.trim() || !conversationId) return
    sendMessage(input.trim())
    setInput('')
    setMentionActive(false)
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('chat-refresh', { detail: { type: 'message_sent' } }))
    }, 300)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionActive && mentionFiltered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((prev) => (prev + 1) % mentionFiltered.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((prev) => (prev - 1 + mentionFiltered.length) % mentionFiltered.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mentionFiltered[mentionIdx].name); return }
      if (e.key === 'Escape') { e.preventDefault(); setMentionActive(false); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const isOwnMessage = (msg: Message) => {
    return msg.sender_type === 'human' && msg.sender_id === user?.id
  }

  // ============================================================
  // 渲染
  // ============================================================

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
      {/* 重连提示条 */}
      {reconnecting && (
        <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-amber-500/15 border-b border-amber-500/20 text-amber-400 px-4 py-1.5 text-xs font-medium backdrop-blur-sm">
          <Loader2 size={12} className="animate-spin" />
          连接断开，正在重新连接…
        </div>
      )}

      {/* 错误 Toast */}
      {errors.length > 0 && (
        <div className="absolute top-4 right-4 z-50 space-y-1 max-w-sm">
          {errors.map((err) => (
            <div
              key={err.timestamp}
              className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl px-3 py-2 text-sm shadow-lg shadow-black/20"
            >
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span className="flex-1">{err.message}</span>
              <button onClick={clearErrors} className="shrink-0 text-rose-400/60 hover:text-rose-400">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ↑ 跳至首个未读消息 */}
      {showJumpToUnread && firstUnreadId && (
        <button
          onClick={handleJumpToUnread}
          className="absolute top-3 right-4 z-40 flex items-center gap-1.5 px-3 py-1.5 bg-primary-500/90 hover:bg-primary-500 text-white text-xs font-medium rounded-full shadow-lg shadow-primary-500/30 backdrop-blur-sm transition-all duration-200"
        >
          <ArrowUp size={14} />
          跳至首个未读
        </button>
      )}

      {/* 消息列表 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-4 bg-canvas relative"
      >
        {/* 顶部哨兵（加载更旧消息的触发器） */}
        <div ref={topSentinelRef} className="h-1" />

        {/* 顶部加载指示器 */}
        {loadingState === 'older' && (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="animate-spin text-textMuted" size={16} />
          </div>
        )}

        {/* 无更多旧消息提示 */}
        {!hasMoreBefore && messages.length > 0 && (
          <div className="text-center text-[10px] text-textMuted py-2 select-none">
            —— 已到聊天开头 ——
          </div>
        )}

        {/* 初始加载 */}
        {loadingState === 'initial' ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin text-textMuted" size={24} />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-textMuted text-sm">
            {conversationType === 'dm' ? '开始你们的对话吧' : '暂无消息，发送第一条消息吧'}
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              data-message-id={msg.id}
              ref={msg.id === firstUnreadId ? firstUnreadRef : undefined}
            >
              {/* 未读分隔线（在 firstUnreadId 消息上方） */}
              {msg.id === firstUnreadId && hasMoreBefore && (
                <div className="flex items-center gap-2 my-3 select-none">
                  <div className="flex-1 h-px bg-rose-500/30" />
                  <span className="text-[10px] font-medium text-rose-400 whitespace-nowrap">新消息</span>
                  <div className="flex-1 h-px bg-rose-500/30" />
                </div>
              )}
              <MessageBubble
                senderName={msg.sender_name || `${msg.sender_type}:${msg.sender_id}`}
                content={msg.content}
                isMine={isOwnMessage(msg)}
                createdAt={msg.created_at}
                senderType={msg.sender_type}
                senderId={msg.sender_id}
                onAvatarClick={(type, id, name, state) =>
                  setProfileCard({ type, id, name, state })
                }
              />
            </div>
          ))
        )}

        {/* AI 思考中占位气泡 */}
        {Array.from(thinkingAgents.entries()).map(([agentId, agentName]) => (
          <MessageBubble
            key={`thinking-${agentId}`}
            senderName={agentName}
            content="..."
            isMine={false}
            createdAt={new Date().toISOString()}
            senderType="ai"
            senderId={agentId}
            thinking={true}
            onAvatarClick={(type, id, name, state) =>
              setProfileCard({ type, id, name, state })
            }
          />
        ))}

        {/* 底部加载指示器 */}
        {loadingState === 'newer' && (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="animate-spin text-textMuted" size={16} />
          </div>
        )}

        {/* 底部哨兵（加载更新消息的触发器） */}
        <div ref={bottomSentinelRef} className="h-1" />
      </div>

      {/* ↓ 回到底部浮动按钮 */}
      {!isAtBottom && messages.length > 0 && (
        <div className="absolute bottom-20 right-6 z-40">
          <button
            onClick={() => scrollToBottom(true)}
            className="flex items-center justify-center w-9 h-9 bg-elevated border border-border rounded-full shadow-lg shadow-black/20 text-textSecondary hover:text-textPrimary hover:bg-surface transition-all duration-200"
            title="回到底部"
          >
            <ArrowDown size={16} />
          </button>
        </div>
      )}

      {/* 输入框 */}
      <div className="p-3 bg-surface border-t border-border relative">
        {/* @提及 自动补全下拉 */}
        {mentionActive && mentionFiltered.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-elevated border border-border rounded-xl shadow-2xl shadow-black/20 z-50 max-h-48 overflow-y-auto">
            {mentionFiltered.map((m, i) => (
              <button
                key={`${m.type}:${m.id}`}
                onClick={() => insertMention(m.name)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  i === mentionIdx
                    ? 'bg-primary-500/15 text-primary-300'
                    : 'text-textPrimary hover:bg-elevated'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  m.state === 'active' ? 'bg-mint-400' :
                  m.state === 'dnd' ? 'bg-rose-400' : 'bg-[#6B7280]'
                }`} />
                <span className="font-medium">{m.name}</span>
                <span className="text-textMuted text-xs ml-auto">
                  {m.type === 'ai' ? '🤖 AI' : '👤'}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              const pos = e.target.selectionStart
              detectMention(e.target.value, pos)
              if (e.target.value && !input) sendTyping(true)
              if (!e.target.value && input) sendTyping(false)
            }}
            onKeyUp={(e) => {
              if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)) {
                const ta = e.currentTarget
                detectMention(ta.value, ta.selectionStart)
              }
            }}
            onClick={(e) => {
              const ta = e.currentTarget
              setTimeout(() => detectMention(ta.value, ta.selectionStart), 0)
            }}
            onKeyDown={handleKeyDown}
            placeholder={conversationType === 'dm' ? '输入私信... Enter 发送' : '输入消息... @AI名称 提及, Enter 发送'}
            rows={1}
            className="flex-1 min-w-0 resize-none rounded-xl border border-border bg-canvas px-4 py-2.5 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/30 transition-shadow"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-2.5 rounded-xl bg-primary-500 text-white hover:bg-primary-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary-500/20"
          >
            <Send size={18} />
          </button>
        </div>
      </div>

      {/* 资料卡 */}
      {profileCard && (
        <ProfileCard
          entityType={profileCard.type as 'human' | 'ai'}
          entityId={profileCard.id}
          entityName={profileCard.name}
          state={profileCard.state}
          onClose={() => setProfileCard(null)}
        />
      )}
    </div>
  )
}
