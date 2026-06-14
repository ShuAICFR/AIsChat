import { useState, useEffect, useRef } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import { api } from '../api/client'
import MessageBubble from './MessageBubble'
import ProfileCard from './ProfileCard'
import { Send, Loader2, Bell, BellOff, AlertTriangle, X, Plus, UserPlus, MessageSquare, ChevronRight } from 'lucide-react'

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
  my_role: string
}

interface ChatAreaProps {
  groupId: number | null
  onSelectGroup: (id: number) => void
}

export default function ChatArea({ groupId, onSelectGroup }: ChatAreaProps) {
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
  const messagesEndRef = useRef<HTMLDivElement>(null)
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
    setLoading(true)
    api.get(`/groups/${groupId}/messages?limit=50`)
      .then(setMessages)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [groupId])

  // 处理收到的 WebSocket 消息
  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.type === 'message') {
      setMessages((prev) => [...prev, lastMessage.data])
    }
  }, [lastMessage])

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    if (!input.trim() || !groupId) return
    sendMessage(input.trim())
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
          return [...prev, { id: dm.group_id, name: dm.group_name, owner_type: 'human', owner_id: 0, is_vector_accelerated: false, my_role: 'owner' }]
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
      {/* 群聊列表 + 好友私信 - 始终可见 */}
      <div className="w-56 bg-surface border-r border-border shrink-0 hidden md:flex flex-col">
        {/* 群聊标题 */}
        <div className="px-3 h-14 border-b border-border font-medium text-sm flex items-center justify-between text-[#EDE9F6]">
          群聊列表
          <button
            onClick={() => setShowCreateGroup(true)}
            className="p-1 rounded-lg hover:bg-[#1E1A30] text-[#6B7280] hover:text-primary-400 transition-colors"
            title="创建群聊"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {/* 群聊 */}
          {regularGroups.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-[#6B7280]">
              暂无群聊，点击 + 创建
            </div>
          ) : (
            regularGroups.map((g) => (
              <button
                key={g.id}
                onClick={() => onSelectGroup(g.id)}
                className={`w-full text-left px-3 py-2.5 text-sm transition-all duration-150 ${
                  g.id === groupId
                    ? 'bg-primary-500/15 text-primary-300 border-l-2 border-primary-400'
                    : 'hover:bg-[#1E1A30] text-[#9CA3B0] border-l-2 border-transparent'
                }`}
              >
                <div className="font-medium truncate"># {g.name}</div>
                {g.is_vector_accelerated && (
                  <span className="text-[10px] text-mint-400 font-medium">⚡ 加速</span>
                )}
              </button>
            ))
          )}

          {/* 已有 DM 列表 */}
          {dmGroups.length > 0 && (
            <>
              <div className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                私信
              </div>
              {dmGroups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => onSelectGroup(g.id)}
                  className={`w-full text-left px-3 py-2 text-sm transition-all duration-150 ${
                    g.id === groupId
                      ? 'bg-primary-500/15 text-primary-300 border-l-2 border-primary-400'
                      : 'hover:bg-[#1E1A30] text-[#9CA3B0] border-l-2 border-transparent'
                  }`}
                >
                  <div className="truncate flex items-center gap-1.5">
                    <MessageSquare size={12} className="shrink-0 text-[#6B7280]" />
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
              <div className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
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
                        : 'hover:bg-[#1E1A30] text-[#9CA3B0] border-l-2 border-transparent'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      f.state === 'active' ? 'bg-mint-400' :
                      f.state === 'dnd' ? 'bg-rose-400' : 'bg-[#6B7280]'
                    }`} />
                    <span className="truncate flex-1">{f.friend_name}</span>
                    <ChevronRight size={12} className="text-[#6B7280] shrink-0" />
                  </button>
                )
              })}
            </>
          )}
        </div>
      </div>

      {/* 主区域：空状态 or 聊天 */}
      {!groupId ? (
        <div className="flex-1 flex items-center justify-center bg-canvas">
          <div className="text-center">
            <MessageBubblePlaceholder />
            <p className="mt-4 text-lg text-[#9CA3B0] font-medium">选择一个群聊开始对话</p>
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
            <h2 className="font-semibold text-[#EDE9F6] text-sm">
              # {currentGroup?.name || '加载中...'}
            </h2>
            <button
              onClick={() => setShowInvite(true)}
              className="p-1 rounded-lg hover:bg-[#1E1A30] text-[#6B7280] hover:text-primary-400 transition-colors"
              title="邀请成员"
            >
              <UserPlus size={16} />
            </button>
            {connected ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-mint-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-mint-400" /> 在线
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] text-[#6B7280]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#6B7280]" /> 离线
              </span>
            )}
            <span
              className="inline-flex items-center gap-1 text-xs text-[#6B7280] cursor-pointer hover:text-rose-400 ml-auto transition-colors"
              title="点击切换免打扰"
            >
              <Bell size={14} />
            </span>
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
                <Loader2 className="animate-spin text-[#6B7280]" size={24} />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[#6B7280] text-sm">
                暂无消息，发送第一条消息吧
              </div>
            ) : (
              messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  senderName={msg.sender_name || `${msg.sender_type}:${msg.sender_id}`}
                  content={msg.content}
                  isHuman={msg.sender_type === 'human'}
                  createdAt={msg.created_at}
                  senderType={msg.sender_type}
                  senderId={msg.sender_id}
                  onAvatarClick={(type, id, name, state) =>
                    setProfileCard({ type, id, name, state })
                  }
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入框 */}
          <div className="p-3 bg-surface border-t border-border">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  if (e.target.value && !input) sendTyping(true)
                  if (!e.target.value && input) sendTyping(false)
                }}
                onKeyDown={handleKeyDown}
                placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                rows={1}
                className="flex-1 resize-none rounded-xl border border-border bg-[#0C0A14] px-4 py-2.5 text-sm text-[#EDE9F6] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/30 transition-shadow"
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
    </div>
  )
}

function MessageBubblePlaceholder() {
  return (
    <svg className="mx-auto" width="80" height="80" viewBox="0 0 80 80" fill="none">
      <rect x="10" y="15" width="60" height="45" rx="12" className="fill-[#1E1A30]" />
      <circle cx="30" cy="37" r="8" className="fill-[#2A2540]" />
      <circle cx="50" cy="37" r="8" className="fill-[#2A2540]" />
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
        <h2 className="text-lg font-semibold mb-4 text-[#EDE9F6]">创建新群聊</h2>
        <div>
          <label className="block text-xs font-medium mb-1.5 text-[#9CA3B0]">群聊名称 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-[#0C0A14] text-[#EDE9F6] placeholder:text-[#6B7280] text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            placeholder="给群聊起个名字"
            autoFocus
          />
        </div>
        {error && <div className="text-sm text-rose-400 mt-3">{error}</div>}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-[#1E1A30] text-[#9CA3B0] transition-colors font-medium"
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
        <h2 className="text-lg font-semibold mb-1 text-[#EDE9F6]">邀请成员</h2>
        <p className="text-xs text-[#6B7280] mb-4">从好友列表勾选要邀请的成员</p>

        {/* 好友列表 */}
        {friendsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin text-[#6B7280]" size={20} />
          </div>
        ) : friends.length === 0 ? (
          <div className="py-8 text-center text-sm text-[#6B7280]">
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
                        : 'hover:bg-[#1E1A30]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFriend(f.friend_type, f.friend_id)}
                      className="w-4 h-4 rounded border-border bg-[#0C0A14] text-primary-500 focus:ring-primary-500/50"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#EDE9F6] truncate">
                          {f.friend_name}
                        </span>
                        <span className="text-xs">
                          {getStateIcon(f.state)}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-[#6B7280] shrink-0">
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
            className="text-xs text-[#6B7280] hover:text-primary-400 mb-3 self-start"
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
                      : 'border-border text-[#9CA3B0] hover:bg-[#1E1A30]'
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
                className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-[#0C0A14] text-sm text-[#EDE9F6] placeholder:text-[#6B7280] focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                placeholder="输入 ID"
                min={1}
              />
              <button
                onClick={handleManualInvite}
                disabled={!manualId.trim() || loading}
                className="px-3 py-1.5 text-xs bg-[#1E1A30] text-[#9CA3B0] rounded-lg hover:bg-[#2A2540] disabled:opacity-30"
              >
                邀请
              </button>
            </div>
            <button
              onClick={() => setShowManual(false)}
              className="text-xs text-[#6B7280] hover:text-[#9CA3B0]"
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
            className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-[#1E1A30] text-[#9CA3B0] transition-colors font-medium"
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
