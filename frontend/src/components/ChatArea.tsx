import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import ChatView from './ChatView'
import ChatSidebar from './ChatSidebar'
import DMChatView from './DMChatView'
import GroupSettingsPanel from './GroupSettingsPanel'
import { Bell, BellOff, UserPlus, Settings, ArrowLeft } from 'lucide-react'

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
  dmSessionId: string | null
}

export default function ChatArea({ groupId, dmSessionId }: ChatAreaProps) {
  const [groups, setGroups] = useState<Group[]>([])
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const navigate = useNavigate()
  const { openDrawer } = useOutletContext<{ openDrawer: () => void }>()

  // 加载群聊列表
  useEffect(() => {
    api.get('/groups').then(setGroups).catch(console.error)
  }, [])

  // 群聊选中变化时刷新未读
  useEffect(() => {
    if (groupId) {
      api.post(`/groups/${groupId}/read`)
        .then(() => api.get('/groups').then(setGroups).catch(() => {}))
        .catch(() => {})
    }
  }, [groupId])

  const currentGroup = groups.find((g) => g.id === groupId)

  const hasActiveConversation = !!(groupId || dmSessionId)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // 移动端无活跃对话时自动全屏展示侧边栏
  useEffect(() => {
    if (!hasActiveConversation && window.innerWidth < 768) {
      setMobileSidebarOpen(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 选中对话后自动关闭手机侧边栏
  useEffect(() => {
    if (hasActiveConversation) setMobileSidebarOpen(false)
  }, [groupId, dmSessionId])

  return (
    <div className="flex h-full relative">
      {/* 统一侧边栏：群聊 + 私信列表 */}
      <div className={`${mobileSidebarOpen ? 'absolute inset-y-0 left-0 z-30' : ''} md:relative md:z-auto`}>
        <ChatSidebar
          activeGroupId={groupId}
          activeSessionId={dmSessionId}
          onCreateGroup={() => setShowCreateGroup(true)}
          openDrawer={openDrawer}
          hideOnMobile={hasActiveConversation && !mobileSidebarOpen}
          onMobileBack={mobileSidebarOpen ? () => setMobileSidebarOpen(false) : undefined}
          mobileFullscreen={mobileSidebarOpen}
        />
      </div>

      {/* ── 右侧主区域 ── */}
      {!hasActiveConversation ? (
        <div
          className="hidden md:flex flex-1 items-center justify-center bg-canvas"
          onClick={mobileSidebarOpen ? () => setMobileSidebarOpen(false) : undefined}
        >
          <div className="text-center">
            <MessageBubblePlaceholder />
            <p className="mt-4 text-lg text-textSecondary font-medium">选择一个对话开始</p>
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
      ) : groupId ? (
        /* ── 群聊 ── */
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="px-4 h-14 border-b border-border bg-surface flex items-center gap-2 shrink-0">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
              title="会话列表"
            >
              <ArrowLeft size={20} />
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
            <span className="inline-flex items-center gap-1 text-[10px] text-mint-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-mint-400" /> 在线
            </span>
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
              title={currentGroup?.dnd_until ? '取消免打扰' : '开启免打扰'}
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
          <ChatView conversationType="group" conversationId={groupId} />
        </div>
      ) : (
        /* ── 私信 ── */
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <DMChatView sessionId={dmSessionId!} onMobileBack={() => setMobileSidebarOpen(true)} />
        </div>
      )}

      {/* 创建群聊弹窗 */}
      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
          onCreated={(newGroup) => {
            setShowCreateGroup(false)
            setGroups((prev) => [...prev, newGroup])
            navigate(`/chat/${newGroup.id}`)
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
            navigate('/chat')
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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
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
  interface SearchResult {
    id: number
    type: 'human' | 'ai'
    name: string
    state?: string
  }

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<string[]>([])
  const [showManual, setShowManual] = useState(false)
  const [manualType, setManualType] = useState<'ai' | 'human'>('ai')
  const [manualId, setManualId] = useState('')

  // 防抖搜索
  useEffect(() => {
    if (query.length < 1) {
      setResults([])
      return
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const data = await api.get<{ results: SearchResult[] }>(
          `/search?q=${encodeURIComponent(query)}`
        )
        setResults(data.results)
      } catch {
        // 静默失败
      } finally {
        setSearchLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const toggleMember = (type: string, id: number) => {
    const key = `${type}:${id}`
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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
        // 单个失败不中断
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
      case 'active': return '\u{1F7E2}'
      case 'dnd': return '\u{1F534}'
      case 'offline': return '\u26AB'
      default: return ''
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl shadow-black/30 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1 text-textPrimary">邀请成员</h2>
        <p className="text-xs text-textMuted mb-4">搜索用户或 AI 并选择邀请</p>

        {/* 搜索框 */}
        <div className="relative mb-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入名称搜索..."
            className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
          />
        </div>

        {/* 搜索结果 */}
        <div className="flex-1 overflow-y-auto border border-border rounded-xl divide-y divide-border/50 mb-4 max-h-48">
          {query.length < 1 ? (
            <div className="py-6 text-center text-xs text-textMuted">
              输入关键词搜索要邀请的成员
            </div>
          ) : searchLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-500" />
            </div>
          ) : results.length === 0 ? (
            <div className="py-6 text-center text-xs text-textMuted">无结果</div>
          ) : (
            results.map((r) => {
              const key = `${r.type}:${r.id}`
              const checked = selected.has(key)
              return (
                <label
                  key={key}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                    checked ? 'bg-primary-500/10' : 'hover:bg-elevated'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMember(r.type, r.id)}
                    className="w-4 h-4 rounded border-border bg-canvas text-primary-500 focus:ring-primary-500/50"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-textPrimary truncate">{r.name}</span>
                      <span className="text-xs">{getStateIcon(r.state)}</span>
                    </div>
                  </div>
                  <span className="text-xs text-textMuted shrink-0">
                    {r.type === 'ai' ? '🤖 AI' : '👤'}
                  </span>
                </label>
              )
            })
          )}
        </div>

        {/* 已选成员摘要 */}
        {selected.size > 0 && (
          <div className="mb-3 text-xs text-textMuted">
            已选 {selected.size} 位成员
          </div>
        )}

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
            <button onClick={() => setShowManual(false)} className="text-xs text-textMuted hover:text-textSecondary">
              收起
            </button>
          </div>
        )}

        {error && <div className="text-sm text-rose-400 mb-2">{error}</div>}
        {success.length > 0 && (
          <div className="text-sm text-mint-400 mb-2">已成功邀请 {success.length} 位成员</div>
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
