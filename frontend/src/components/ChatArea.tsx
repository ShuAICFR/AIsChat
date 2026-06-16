import { useState, useEffect, useRef } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { useWebSocket } from '../hooks/useWebSocket'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import MessageBubble from './MessageBubble'
import ProfileCard from './ProfileCard'
import GroupSettingsPanel from './GroupSettingsPanel'
import { Send, Loader2, Bell, BellOff, AlertTriangle, X, Plus, UserPlus, MessageSquare, ChevronRight, Settings, Menu, ArrowLeft } from 'lucide-react'

interface Message {
  id: number
  group_id: number
  sender_type: string
  sender_id: number
  sender_name: string | null
  content: string
  reply_to: number | null
  created_at: string
}

interface Group {
  id: number
  name: string
  owner_type: string
  owner_id: number
  is_vector_accelerated: boolean
  announcement: string | null
  speak_limit_per_minute: number
  speak_limit_window_seconds: number
  my_role: string
  unread_count: number
  has_mention: boolean
  last_message_preview: string | null
  dnd_until: string | null
  created_at: string | null
}

interface ChatAreaProps {
  groupId: number | null
  onSelectGroup: (id: number) => void
}

export default function ChatArea({ groupId, onSelectGroup }: ChatAreaProps) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [friends, setFriends] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [profileCard, setProfileCard] = useState<{
    type: string; id: number; name: string; state?: string
  } | null>(null)
  const [thinkingAgents, setThinkingAgents] = useState<Map<number, string>>(new Map())
  const [showSettings, setShowSettings] = useState(false)
  // @提及 自动补全
  const [groupMembers, setGroupMembers] = useState<Array<{ type: string; id: number; name: string; state?: string }>>([])
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { openDrawer } = useOutletContext<{ openDrawer: () => void }>()
  const { lastMessage, connected, errors, unreadSummary, sendMessage, sendTyping, clearErrors, clearSummary } = useWebSocket(groupId)

  // 加载群聊列表
  useEffect(() => {
    api.get('/groups').then(setGroups).catch(console.error)
  }, [])

  // 加载好友列表
  useEffect(() => {
    api.get('/friends').then(setFriends).catch(console.error)
  }, [])

  // 加载消息
  useEffect(() => {
    if (!groupId) return
    setThinkingAgents(new Map())
    setLoading(true)
    // 并行请求：标记已读、加载成员、加载消息
    Promise.all([
      api.post(`/groups/${groupId}/read`)
        .then(() => api.get('/groups').then(setGroups).catch(() => {}))
        .catch(() => {}),
      api.get(`/groups/${groupId}/members`).then(setGroupMembers).catch(console.error),
      api.get(`/groups/${groupId}/messages?limit=50`)
        .then(setMessages)
        .catch(console.error),
    ]).finally(() => setLoading(false))
  }, [groupId])

  // 处理收到的 WebSocket 消息
  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.type === 'message') {
      const msg = lastMessage.data
      setMessages((prev) => [...prev, msg])
      // AI 消息到达 → 清除该 AI 的思考状态
      if (msg.sender_type === 'ai' && msg.sender_id) {
        setThinkingAgents((prev) => {
          const next = new Map(prev)
          next.delete(msg.sender_id)
          return next
        })
      }
    } else if (lastMessage.type === 'ai_thinking') {
      const d = lastMessage.data
      if (d.group_id === groupId) {
        setThinkingAgents((prev) => {
          const next = new Map(prev)
          next.set(d.agent_id, d.agent_name)
          return next
        })
      }
    } else if (lastMessage.type === 'ai_thinking_end') {
      const d = lastMessage.data
      if (d.group_id === groupId) {
        setThinkingAgents((prev) => {
          const next = new Map(prev)
          next.delete(d.agent_id)
          return next
        })
      }
    } else if (lastMessage.type === 'dm_notification') {
      // AI 发来私信 → 刷新群列表（侧边栏 DM 分区会显示新消息 + 未读数）
      api.get('/groups').then(setGroups).catch(console.error)
      // 不再插入系统消息到当前群聊——用户去左侧私信分区查看即可
    } else if (lastMessage.type === 'unread_update') {
      // 其他群聊的未读更新 → 刷新群列表
      api.get('/groups').then(setGroups).catch(console.error)
    } else if (lastMessage.type === 'announcement') {
      const d = lastMessage.data
      if (d.group_id === groupId) {
        setMessages((prev) => [...prev, {
          id: -Date.now(),
          group_id: groupId,
          sender_type: 'system',
          sender_id: 0,
          sender_name: '📢 群公告',
          content: d.content,
          reply_to: null,
          created_at: new Date().toISOString(),
        } as Message])
      }
    }
  }, [lastMessage, groupId])

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // @提及 过滤后的成员列表
  const mentionFiltered = mentionQuery
    ? groupMembers.filter((m) => m.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : groupMembers

  // 检测输入框中 @ 位置，触发自动补全
  const detectMention = (value: string, cursorPos: number) => {
    // 找光标前最近的 @
    const beforeCursor = value.slice(0, cursorPos)
    const atIdx = beforeCursor.lastIndexOf('@')
    if (atIdx === -1) { setMentionActive(false); return }
    // 确保 @ 是文本开头或前面是空格
    if (atIdx > 0 && beforeCursor[atIdx - 1] !== ' ') { setMentionActive(false); return }
    // 提取 @ 后的查询文本（直到光标）
    const query = beforeCursor.slice(atIdx + 1, cursorPos)
    // 如果查询包含空格，说明已完成输入，关闭补全
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
    // 替换 @query → @name（带尾部空格）
    const newBefore = beforeCursor.slice(0, atIdx) + '@' + name + ' '
    const newValue = newBefore + value.slice(cursorPos)
    setInput(newValue)
    setMentionActive(false)
    // 恢复焦点并移动光标到插入名称后
    requestAnimationFrame(() => {
      ta.focus()
      const newPos = newBefore.length
      ta.setSelectionRange(newPos, newPos)
    })
  }

  const handleSend = () => {
    if (!input.trim() || !groupId) return
    sendMessage(input.trim())
    setInput('')
    setMentionActive(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // @提及 下拉导航
    if (mentionActive && mentionFiltered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx((prev) => (prev + 1) % mentionFiltered.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx((prev) => (prev - 1 + mentionFiltered.length) % mentionFiltered.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(mentionFiltered[mentionIdx].name)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionActive(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleStartDM = async (friendType: string, friendId: number) => {
    try {
      const dm = await api.post(`/dm/${friendType}/${friendId}`)
      if (dm.group_id) {
        // 确保群聊列表包含这个 DM
        setGroups((prev) => {
          if (prev.find((g) => g.id === dm.group_id)) return prev
          return [...prev, {
            id: dm.group_id, name: dm.group_name,
            owner_type: 'human', owner_id: 0,
            is_vector_accelerated: false, my_role: 'owner',
            announcement: null, speak_limit_per_minute: 0,
            speak_limit_window_seconds: 120,
            unread_count: 0, has_mention: false,
            last_message_preview: null, dnd_until: null, created_at: null,
          }]
        })
        onSelectGroup(dm.group_id)
      }
    } catch (err: any) {
      console.error('创建私信失败:', err)
    }
  }

  // 分离普通群聊和 DM
  const regularGroups = groups.filter((g) => !g.name.startsWith('DM:'))
  const dmGroups = groups.filter((g) => g.name.startsWith('DM:'))

  const currentGroup = groups.find((g) => g.id === groupId)

  return (
    <div className="flex h-full">
      {/* 群聊列表 + 好友私信 — 桌面端常驻，移动端在无选中群聊时全屏显示 */}
      <div className={`w-56 bg-surface border-r border-border shrink-0 flex-col md:flex ${
        groupId ? 'hidden' : 'flex'
      }`}>
        {/* 群聊标题 */}
        <div className="px-3 h-14 border-b border-border font-medium text-sm flex items-center justify-between text-textPrimary shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={openDrawer}
              className="md:hidden p-1.5 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
              title="菜单"
            >
              <Menu size={18} />
            </button>
            群聊列表
          </div>
          <button
            onClick={() => setShowCreateGroup(true)}
            className="p-1 rounded-lg hover:bg-elevated text-textMuted hover:text-primary-400 transition-colors"
            title="创建群聊"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {/* 群聊 */}
          {regularGroups.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-textMuted">
              暂无群聊，点击 + 创建
            </div>
          ) : (
            regularGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => onSelectGroup(g.id)}
                className={`w-full text-left px-3 py-2 text-sm transition-all duration-150 ${
                  g.id === groupId
                    ? 'bg-primary-500/15 text-primary-300 border-l-2 border-primary-400'
                    : 'hover:bg-elevated text-textSecondary border-l-2 border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium truncate flex items-center gap-1">
                    <span className="truncate"># {g.name}</span>
                  </div>
                  {g.unread_count > 0 && (
                    <span className={`shrink-0 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                      g.has_mention
                        ? 'bg-rose-500 shadow-sm shadow-rose-500/30'
                        : 'bg-primary-500/80'
                    }`}>
                      {g.unread_count > 99 ? '99+' : g.unread_count}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-textMuted truncate mt-0.5">
                  {g.dnd_until && <BellOff size={10} className="inline mr-1 text-rose-400" />}
                  {g.has_mention && !g.dnd_until && (
                    <span className="text-rose-400 font-medium">[@你] </span>
                  )}
                  {g.last_message_preview || '暂无消息'}
                </div>
              </button>
            ))
          )}

          {/* 已有 DM 列表 */}
          {dmGroups.length > 0 && (
            <>
              <div className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-textMuted">
                私信
              </div>
              {dmGroups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => onSelectGroup(g.id)}
                  className={`w-full text-left px-3 py-2 text-sm transition-all duration-150 ${
                    g.id === groupId
                      ? 'bg-primary-500/15 text-primary-300 border-l-2 border-primary-400'
                      : 'hover:bg-elevated text-textSecondary border-l-2 border-transparent'
                  }`}
                >
                  <div className="truncate flex items-center gap-1.5">
                    <MessageSquare size={12} className="shrink-0 text-textMuted" />
                    <span className="font-medium">
                      {g.name.replace(/^DM:\s*/, '')}
                    </span>
                  </div>
                </button>
              ))}
            </>
          )}

          {/* 好友列表（可点击发起 DM） */}
          {friends.length > 0 && (
            <>
              <div className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-textMuted">
                好友
              </div>
              {friends.map((f) => {
                const key = `${f.friend_type}:${f.friend_id}`
                const isActive = dmGroups.some(
                  (g) => g.name.includes(f.friend_name) && g.id === groupId
                )
                return (
                  <button
                    key={key}
                    onClick={() => {
                      const existing = dmGroups.find((g) =>
                        g.name.includes(f.friend_name)
                      )
                      if (existing) {
                        onSelectGroup(existing.id)
                      } else {
                        handleStartDM(f.friend_type, f.friend_id)
                      }
                    }}
                    className={`w-full text-left px-3 py-2 text-sm transition-all duration-150 flex items-center gap-2 ${
                      isActive
                        ? 'bg-primary-500/15 text-primary-300 border-l-2 border-primary-400'
                        : 'hover:bg-elevated text-textSecondary border-l-2 border-transparent'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      f.state === 'active' ? 'bg-mint-400' :
                      f.state === 'dnd' ? 'bg-rose-400' : 'bg-[#6B7280]'
                    }`} />
                    <span className="truncate flex-1">{f.friend_name}</span>
                    <ChevronRight size={12} className="text-textMuted shrink-0" />
                  </button>
                )
              })}
            </>
          )}
        </div>
      </div>

      {/* 主区域：空状态（桌面端）or 聊天 */}
      {!groupId ? (
        <div className="hidden md:flex flex-1 items-center justify-center bg-canvas">
          <div className="text-center">
            <MessageBubblePlaceholder />
            <p className="mt-4 text-lg text-textSecondary font-medium">选择一个群聊开始对话</p>
            {groups.length === 0 && (
              <button
                onClick={() => setShowCreateGroup(true)}
                className="mt-5 px-5 py-2.5 bg-primary-500 text-white rounded-xl hover:bg-primary-400 text-sm font-medium transition-all shadow-lg shadow-primary-500/20"
              >
                创建第一个群聊
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0">
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

          {/* 群聊头部 */}
          <div className="px-4 h-14 border-b border-border bg-surface flex items-center gap-2 shrink-0">
            {/* 移动端：返回群列表 + 汉堡菜单 */}
            <button
              onClick={() => navigate('/chat')}
              className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <button
              onClick={openDrawer}
              className="md:hidden p-1.5 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
              title="菜单"
            >
              <Menu size={18} />
            </button>
            <h2 className="font-semibold text-textPrimary text-sm truncate">
              # {currentGroup?.name || '加载中...'}
            </h2>
            <button
              onClick={() => setShowInvite(true)}
              className="p-1 rounded-lg hover:bg-elevated text-textMuted hover:text-primary-400 transition-colors"
              title="邀请成员"
            >
              <UserPlus size={16} />
            </button>
            {connected ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-mint-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-mint-400" /> 在线
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] text-textMuted">
                <span className="w-1.5 h-1.5 rounded-full bg-[#6B7280]" /> 离线
              </span>
            )}
            <button
              onClick={async () => {
                if (!currentGroup) return
                try {
                  if (currentGroup.dnd_until) {
                    await api.post(`/groups/${currentGroup.id}/dnd/cancel`)
                    setGroups(prev => prev.map(g => g.id === currentGroup.id ? { ...g, dnd_until: null } : g))
                  } else {
                    await api.post(`/groups/${currentGroup.id}/dnd`, { group_id: currentGroup.id, duration_minutes: null })
                    setGroups(prev => prev.map(g => g.id === currentGroup.id ? { ...g, dnd_until: 'permanent' } : g))
                  }
                } catch { /* ignore */ }
              }}
              className={`p-1 rounded-lg transition-colors ml-auto ${
                currentGroup?.dnd_until
                  ? 'text-rose-400 hover:bg-rose-400/10'
                  : 'text-textMuted hover:text-rose-400 hover:bg-elevated'
              }`}
              title={currentGroup?.dnd_until ? '点击取消免打扰' : '点击开启免打扰'}
            >
              {currentGroup?.dnd_until ? <BellOff size={14} /> : <Bell size={14} />}
            </button>
            {currentGroup && (
              <button
                onClick={() => setShowSettings(true)}
                className="p-1 rounded-lg hover:bg-elevated text-textMuted hover:text-textSecondary transition-colors"
                title="群聊设置"
              >
                <Settings size={14} />
              </button>
            )}
          </div>

          {/* 未读摘要提示 */}
          {unreadSummary && (
            <div className="px-4 py-2.5 bg-primary-500/10 border-b border-primary-500/20">
              <div className="flex items-center justify-between">
                <span className="text-sm text-primary-300 font-medium">
                  📋 未读消息摘要
                </span>
                <button onClick={clearSummary} className="text-primary-400/60 hover:text-primary-400">
                  <X size={14} />
                </button>
              </div>
              <div className="mt-1 space-y-1">
                {unreadSummary.groups?.map((g) => (
                  <div key={g.group_id} className="text-xs text-primary-300/80">
                    <span className="font-medium">{g.group_name}</span>：{g.unread_count} 条新消息 — {g.last_message_preview}
                  </div>
                ))}
              </div>
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
                暂无消息，发送第一条消息吧
              </div>
            ) : (
              messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  senderName={msg.sender_name || `${msg.sender_type}:${msg.sender_id}`}
                  content={msg.content}
                  isMine={msg.sender_type === 'human' && msg.sender_id === user?.id}
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
                  // 方向键移动光标后重新检测 @提及
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
                placeholder="输入消息... @AI名称 提及, Enter 发送, Shift+Enter 换行"
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
        </div>
      )}

      {/* 创建群聊弹窗 */}
      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
          onCreated={(newGroup) => {
            setShowCreateGroup(false)
            setGroups((prev) => [...prev, newGroup])
            onSelectGroup(newGroup.id)
          }}
        />
      )}

      {/* 邀请成员弹窗 */}
      {showInvite && (
        <InviteMemberModal
          groupId={groupId!}
          onClose={() => setShowInvite(false)}
        />
      )}

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

      {/* 群设置面板 */}
      {showSettings && currentGroup && (
        <GroupSettingsPanel
          group={{
            id: currentGroup.id,
            name: currentGroup.name,
            owner_type: currentGroup.owner_type,
            owner_id: currentGroup.owner_id,
            is_vector_accelerated: currentGroup.is_vector_accelerated,
            announcement: currentGroup.announcement,
            speak_limit_per_minute: currentGroup.speak_limit_per_minute,
            speak_limit_window_seconds: currentGroup.speak_limit_window_seconds,
            my_role: currentGroup.my_role,
          }}
          onClose={() => setShowSettings(false)}
          onUpdate={(updated) => {
            setGroups((prev) =>
              prev.map((g) => (g.id === currentGroup.id ? { ...g, ...updated } : g))
            )
          }}
          onLeave={() => {
            setShowSettings(false)
            setGroups((prev) => prev.filter((g) => g.id !== currentGroup.id))
            onSelectGroup(groups.find(g => g.id !== currentGroup.id)?.id || 0)
          }}
        />
      )}
    </div>
  )
}

function MessageBubblePlaceholder() {
  return (
    <svg className="mx-auto" width="80" height="80" viewBox="0 0 80 80" fill="none">
      <rect x="10" y="15" width="60" height="45" rx="12" className="fill-elevated" />
      <circle cx="30" cy="37" r="8" className="fill-border" />
      <circle cx="50" cy="37" r="8" className="fill-border" />
    </svg>
  )
}

function CreateGroupModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (group: Group) => void
}) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const newGroup = await api.post('/groups', { name: name.trim() })
      onCreated(newGroup)
    } catch (err: any) {
      setError(err.message || '创建失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl shadow-black/30"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4 text-textPrimary">创建新群聊</h2>
        <div>
          <label className="block text-xs font-medium mb-1.5 text-textSecondary">群聊名称 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-textPrimary placeholder:text-textMuted text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            placeholder="给群聊起个名字"
            autoFocus
          />
        </div>
        {error && <div className="text-sm text-rose-400 mt-3">{error}</div>}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-elevated text-textSecondary transition-colors font-medium"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="flex-1 py-2.5 text-sm bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-30 font-medium transition-all shadow-lg shadow-primary-500/20"
          >
            {loading ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

function InviteMemberModal({
  groupId,
  onClose,
}: {
  groupId: number
  onClose: () => void
}) {
  interface Friend {
    friend_type: string
    friend_id: number
    friend_name: string
    state?: string
  }

  const [friends, setFriends] = useState<Friend[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [friendsLoading, setFriendsLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<string[]>([])
  const [showManual, setShowManual] = useState(false)
  const [manualType, setManualType] = useState<'ai' | 'human'>('ai')
  const [manualId, setManualId] = useState('')

  // 加载好友列表
  useEffect(() => {
    api.get<Friend[]>('/friends')
      .then(setFriends)
      .catch(() => setError('加载好友列表失败'))
      .finally(() => setFriendsLoading(false))
  }, [])

  const toggleFriend = (type: string, id: number) => {
    const key = `${type}:${id}`
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === friends.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(friends.map((f) => `${f.friend_type}:${f.friend_id}`)))
    }
  }

  const handleInviteSelected = async () => {
    if (selected.size === 0) return
    setLoading(true)
    setError('')
    setSuccess([])
    const ok: string[] = []
    for (const key of selected) {
      const [member_type, idStr] = key.split(':')
      const member_id = parseInt(idStr)
      try {
        await api.post(`/groups/${groupId}/invite`, { member_type, member_id })
        ok.push(key)
      } catch {
        // 单个失败不中断，继续邀请其他的
      }
    }
    setSuccess(ok)
    if (ok.length === selected.size) {
      setTimeout(onClose, 1200)
    } else if (ok.length === 0) {
      setError('邀请失败，请重试')
    }
    setLoading(false)
  }

  const handleManualInvite = async () => {
    const id = parseInt(manualId)
    if (!id || id <= 0) {
      setError('请输入有效的 ID')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.post(`/groups/${groupId}/invite`, {
        member_type: manualType,
        member_id: id,
      })
      setSuccess([`${manualType}:${id}`])
      setTimeout(onClose, 1000)
    } catch (err: any) {
      setError(err.message || '邀请失败')
    } finally {
      setLoading(false)
    }
  }

  const getStateIcon = (s?: string) => {
    switch (s) {
      case 'active': return '🟢'
      case 'dnd': return '🔴'
      case 'offline': return '⚫'
      default: return ''
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl shadow-black/30 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1 text-textPrimary">邀请成员</h2>
        <p className="text-xs text-textMuted mb-4">从好友列表勾选要邀请的成员</p>

        {/* 好友列表 */}
        {friendsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-textMuted" size={20} />
          </div>
        ) : friends.length === 0 ? (
          <div className="py-8 text-center text-sm text-textMuted">
            暂无好友，请先在搜索框中添加好友
          </div>
        ) : (
          <>
            {/* 全选 */}
            <button
              onClick={selectAll}
              className="text-xs text-primary-400 hover:text-primary-300 mb-2 self-start"
            >
              {selected.size === friends.length ? '取消全选' : '全选'}
            </button>

            {/* 好友勾选列表 */}
            <div className="flex-1 overflow-y-auto border border-border rounded-xl divide-y divide-border/50 mb-4 max-h-64">
              {friends.map((f) => {
                const key = `${f.friend_type}:${f.friend_id}`
                const checked = selected.has(key)
                return (
                  <label
                    key={key}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                      checked
                        ? 'bg-primary-500/10'
                        : 'hover:bg-elevated'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFriend(f.friend_type, f.friend_id)}
                      className="w-4 h-4 rounded border-border bg-canvas text-primary-500 focus:ring-primary-500/50"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-textPrimary truncate">
                          {f.friend_name}
                        </span>
                        <span className="text-xs">
                          {getStateIcon(f.state)}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-textMuted shrink-0">
                      {f.friend_type === 'ai' ? '🤖 AI' : '👤'}
                    </span>
                  </label>
                )
              })}
            </div>
          </>
        )}

        {/* 手动输入（折叠） */}
        {!showManual ? (
          <button
            onClick={() => setShowManual(true)}
            className="text-xs text-textMuted hover:text-primary-400 mb-3 self-start"
          >
            + 手动输入 ID
          </button>
        ) : (
          <div className="space-y-2 mb-3 border border-dashed border-border rounded-xl p-3">
            <div className="flex gap-2">
              {(['ai', 'human'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setManualType(t)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                    manualType === t
                      ? 'bg-primary-500/15 border-primary-500/40 text-primary-300'
                      : 'border-border text-textSecondary hover:bg-elevated'
                  }`}
                >
                  {t === 'ai' ? '🤖 AI' : '👤 人类'}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualInvite()}
                className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                placeholder="输入 ID"
                min={1}
              />
              <button
                onClick={handleManualInvite}
                disabled={!manualId.trim() || loading}
                className="px-3 py-1.5 text-xs bg-elevated text-textSecondary rounded-lg hover:bg-border disabled:opacity-30"
              >
                邀请
              </button>
            </div>
            <button
              onClick={() => setShowManual(false)}
              className="text-xs text-textMuted hover:text-textSecondary"
            >
              收起
            </button>
          </div>
        )}

        {error && <div className="text-sm text-rose-400 mb-2">{error}</div>}
        {success.length > 0 && (
          <div className="text-sm text-mint-400 mb-2">
            已成功邀请 {success.length} 位好友
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-elevated text-textSecondary transition-colors font-medium"
          >
            取消
          </button>
          <button
            onClick={handleInviteSelected}
            disabled={selected.size === 0 || loading}
            className="flex-1 py-2.5 text-sm bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-30 font-medium transition-all shadow-lg shadow-primary-500/20"
          >
            {loading ? '邀请中...' : `邀请 (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}
