import { useState, useEffect, useRef } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import MessageBubble from './MessageBubble'
import ProfileCard from './ProfileCard'
import { Send, Loader2, AlertTriangle, X } from 'lucide-react'

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
  conversationId: number | string  // group_id: number, session_id: string
  /** DM 场景下要排除的 @提及 成员信息（对方 ID），避免 AI 在 DM 中尝试 @提及 */
}

export default function ChatView({ conversationType, conversationId }: ChatViewProps) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [profileCard, setProfileCard] = useState<{
    type: string; id: number; name: string; state?: string
  } | null>(null)
  const [thinkingAgents, setThinkingAgents] = useState<Map<number, string>>(new Map())
  // @提及 自动补全（仅群聊）
  const [groupMembers, setGroupMembers] = useState<Array<{ type: string; id: number; name: string; state?: string }>>([])
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { lastMessage, connected, errors, sendMessage, sendTyping, clearErrors } = useWebSocket(conversationType, conversationId)

  // 加载消息
  useEffect(() => {
    if (!conversationId) return
    setThinkingAgents(new Map())
    setLoading(true)

    const loadMessages = async () => {
      try {
        if (conversationType === 'group') {
          api.post(`/groups/${conversationId}/read`).catch(() => {})
          const membersData = await api.get(`/groups/${conversationId}/members`)
          setGroupMembers(membersData)
          const msgs = await api.get<Message[]>(`/groups/${conversationId}/messages?limit=50`)
          setMessages(msgs)
        } else {
          // DM: 获取会话详情（含消息）
          const session = await api.get(`/dm/${conversationId}`)
          setMessages(session.messages || [])
        }
      } catch (err) {
        console.error('加载消息失败:', err)
      } finally {
        setLoading(false)
      }
    }
    loadMessages()
  }, [conversationId, conversationType])

  // 处理收到的 WebSocket 消息
  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.type === 'message') {
      const msg = lastMessage.data
      setMessages((prev) => [...prev, msg])
      if (msg.sender_type === 'ai' && msg.sender_id) {
        setThinkingAgents((prev) => {
          const next = new Map(prev)
          next.delete(msg.sender_id)
          return next
        })
      }
    } else if (lastMessage.type === 'ai_thinking') {
      const d = lastMessage.data
      setThinkingAgents((prev) => {
        const next = new Map(prev)
        next.set(d.agent_id, d.agent_name)
        return next
      })
    } else if (lastMessage.type === 'ai_thinking_end') {
      const d = lastMessage.data
      setThinkingAgents((prev) => {
        const next = new Map(prev)
        next.delete(d.agent_id)
        return next
      })
    } else if (lastMessage.type === 'announcement') {
      const d = lastMessage.data
      setMessages((prev) => [...prev, {
        id: -Date.now(),
        sender_type: 'system',
        sender_id: 0,
        sender_name: '📢 群公告',
        content: d.content,
        reply_to: null,
        created_at: new Date().toISOString(),
      } as Message])
    }
  }, [lastMessage])

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // @提及过滤（仅群聊）
  const mentionFiltered = mentionQuery
    ? groupMembers.filter((m) => m.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : groupMembers

  const detectMention = (value: string, cursorPos: number) => {
    if (conversationType === 'dm') return  // DM 不需要 @提及
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

  return (
    <div className="flex-1 flex flex-col min-w-0 relative">
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

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-canvas">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin text-textMuted" size={24} />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-textMuted text-sm">
            {conversationType === 'dm' ? '开始你们的对话吧' : '暂无消息，发送第一条消息吧'}
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
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
        <div ref={messagesEndRef} />
      </div>

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
            className="flex-1 resize-none rounded-xl border border-border bg-canvas px-4 py-2.5 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/30 transition-shadow"
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
