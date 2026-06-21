import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import ChatView from './ChatView'
import ChatSidebar from './ChatSidebar'
import DMChatView from './DMChatView'
import GroupSettingsPanel from './GroupSettingsPanel'
import { Bell, BellOff, UserPlus, Settings, ArrowLeft, Bot, User } from 'lucide-react'
import { useT } from '../i18n/I18nContext'

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
  member_count: number
  online_count: number
}

interface ChatAreaProps {
  groupId: number | null
  dmSessionId: string | null
}

export default function ChatArea({ groupId, dmSessionId }: ChatAreaProps) {
  const t = useT()
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

  // 移动端侧边栏全屏状态：初始化时根据当前条件直接计算，避免闪烁
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(() => {
    return !hasActiveConversation && window.innerWidth < 768
  })

  // 活跃对话状态变化时，自动切换移动端侧边栏
  useEffect(() => {
    if (window.innerWidth >= 768) return
    if (hasActiveConversation) {
      setMobileSidebarOpen(false)  // 进入对话 → 关闭侧边栏
    } else {
      setMobileSidebarOpen(true)   // 离开对话 → 全屏展示侧边栏
    }
  }, [hasActiveConversation])

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
            <p className="mt-4 text-lg text-textSecondary font-medium">{t('chat.selectConversation')}</p>
            {groups.length === 0 && (
              <button
                onClick={() => setShowCreateGroup(true)}
                className="mt-5 px-5 py-2.5 bg-primary-500 text-white rounded-xl hover:bg-primary-400 text-sm font-medium transition-all shadow-lg shadow-primary-500/20"
              >
                {t('chat.createFirstGroup')}
              </button>
            )}
          </div>
        </div>
      ) : groupId ? (
        /* ── 群聊 ── */
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="px-4 h-14 border-b border-border bg-surface flex items-center gap-2 shrink-0">
            <button
              onClick={() => navigate('/chat')}
              className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
              title={t('chat.sessionList')}
            >
              <ArrowLeft size={20} />
            </button>
            <h2 className="font-semibold text-textPrimary text-sm truncate">
              # {currentGroup?.name || t('chat.loading')}
            </h2>
            <button
              onClick={() => setShowInvite(true)}
              className="p-1 rounded-lg hover:bg-elevated text-textMuted hover:text-primary-400 transition-colors"
              title={t('chat.inviteMembers')}
            >
              <UserPlus size={16} />
            </button>
            <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${(currentGroup?.online_count ?? 0) === 0 ? 'text-slate-400' : 'text-mint-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${(currentGroup?.online_count ?? 0) === 0 ? 'bg-slate-400' : 'bg-mint-400'}`} /> {t('chat.onlineCount')}: {currentGroup?.online_count ?? 0}
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
              title={currentGroup?.dnd_until ? t('chat.unmute') : t('chat.mute')}
            >
              {currentGroup?.dnd_until ? <BellOff size={14} /> : <Bell size={14} />}
            </button>
            {currentGroup && (
              <button
                onClick={() => setShowSettings(true)}
                className="p-1 rounded-lg hover:bg-elevated text-textMuted hover:text-textSecondary transition-colors"
                title={t('chat.groupSettings')}
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
  const t = useT()
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
      setError(err.message || t('chat.createFailed'))
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
        <h2 className="text-lg font-semibold mb-4 text-textPrimary">{t('chat.createNewGroup')}</h2>
        <div>
          <label className="block text-xs font-medium mb-1.5 text-textSecondary">{t('chat.groupName')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-textPrimary placeholder:text-textMuted text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            placeholder={t('chat.groupNamePlaceholder')}
            autoFocus
          />
        </div>
        {error && <div className="text-sm text-rose-400 mt-3">{error}</div>}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-elevated text-textSecondary transition-colors font-medium"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="flex-1 py-2.5 text-sm bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-30 font-medium transition-all shadow-lg shadow-primary-500/20"
          >
            {loading ? t('chat.creating') : t('chat.create')}
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
  const t = useT()
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
      setError(t('chat.inviteFailedRetry'))
    }
    setLoading(false)
  }

  const handleManualInvite = async () => {
    const id = parseInt(manualId)
    if (!id || id <= 0) {
      setError(t('chat.enterValidId'))
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
      setError(err.message || t('chat.inviteFailed'))
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
        <h2 className="text-lg font-semibold mb-1 text-textPrimary">{t('chat.inviteMembers')}</h2>
        <p className="text-xs text-textMuted mb-4">{t('chat.inviteSearchHint')}</p>

        {/* 搜索框 */}
        <div className="relative mb-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('chat.searchNamePlaceholder')}
            className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
          />
        </div>

        {/* 搜索结果 */}
        <div className="flex-1 overflow-y-auto border border-border rounded-xl divide-y divide-border/50 mb-4 max-h-48">
          {query.length < 1 ? (
            <div className="py-6 text-center text-xs text-textMuted">
              {t('chat.inviteSearchPrompt')}
            </div>
          ) : searchLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-500" />
            </div>
          ) : results.length === 0 ? (
            <div className="py-6 text-center text-xs text-textMuted">{t('common.noResults')}</div>
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
                    {r.type === 'ai' ? <><Bot size={12} className="inline" /> AI</> : <User size={12} className="inline" />}
                  </span>
                </label>
              )
            })
          )}
        </div>

        {/* 已选成员摘要 */}
        {selected.size > 0 && (
          <div className="mb-3 text-xs text-textMuted">
            {t('chat.selectedMembers').replace('{size}', String(selected.size))}
          </div>
        )}

        {!showManual ? (
          <button
            onClick={() => setShowManual(true)}
            className="text-xs text-textMuted hover:text-primary-400 mb-3 self-start"
          >
            {t('chat.manualId')}
          </button>
        ) : (
          <div className="space-y-2 mb-3 border border-dashed border-border rounded-xl p-3">
            <div className="flex gap-2">
              {(['ai', 'human'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setManualType(type)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                    manualType === type
                      ? 'bg-primary-500/15 border-primary-500/40 text-primary-600 dark:text-primary-300'
                      : 'border-border text-textSecondary hover:bg-elevated'
                  }`}
                >
                  {type === 'ai' ? <><Bot size={12} className="inline" /> AI</> : <><User size={12} className="inline" /> {t('friends.human')}</>}
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
                placeholder={t('chat.manualIdPlaceholder')}
                min={1}
              />
              <button
                onClick={handleManualInvite}
                disabled={!manualId.trim() || loading}
                className="px-3 py-1.5 text-xs bg-elevated text-textSecondary rounded-lg hover:bg-border disabled:opacity-30"
              >
                {t('chat.invite')}
              </button>
            </div>
            <button onClick={() => setShowManual(false)} className="text-xs text-textMuted hover:text-textSecondary">
              {t('common.collapse')}
            </button>
          </div>
        )}

        {error && <div className="text-sm text-rose-400 mb-2">{error}</div>}
        {success.length > 0 && (
          <div className="text-sm text-mint-400 mb-2">{t('chat.inviteSuccess').replace('{success}', String(success.length))}</div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-elevated text-textSecondary transition-colors font-medium"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleInviteSelected}
            disabled={selected.size === 0 || loading}
            className="flex-1 py-2.5 text-sm bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-30 font-medium transition-all shadow-lg shadow-primary-500/20"
          >
            {loading ? t('chat.inviting') : t('chat.inviteCount').replace('{count}', String(selected.size))}
          </button>
        </div>
      </div>
    </div>
  )
}
