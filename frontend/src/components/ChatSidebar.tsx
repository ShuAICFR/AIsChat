import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Plus, BellOff, Menu, UserPlus, Users } from 'lucide-react'
import { getStateDotColor } from '../constants'

interface Group {
  id: number
  name: string
  unread_count: number
  has_mention: boolean
  last_message_preview: string | null
  last_message_at: string | null
  dnd_until: string | null
}

interface DMSession {
  session_id: string
  partner: { id: number; name: string; type: string; state: string | null }
  last_message_preview: string | null
  last_message_at: string | null
  unread_count: number
}

interface ChatSidebarProps {
  activeGroupId: number | null
  activeSessionId: string | null
  onCreateGroup: () => void
  openDrawer: () => void
  /** 移动端选中对话后隐藏侧边栏 */
  hideOnMobile: boolean
  /** 移动端返回当前对话（侧边栏作为 overlay 时） */
  onMobileBack?: () => void
  /** 移动端全屏覆盖模式 */
  mobileFullscreen?: boolean
}

export default function ChatSidebar({
  activeGroupId,
  activeSessionId,
  onCreateGroup,
  openDrawer,
  hideOnMobile,
  onMobileBack,
  mobileFullscreen,
}: ChatSidebarProps) {
  const [groups, setGroups] = useState<Group[]>([])
  const [dmSessions, setDmSessions] = useState<DMSession[]>([])
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const navigate = useNavigate()

  const loadGroups = () => api.get('/groups').then(setGroups).catch(() => {})
  const loadDMSessions = () => api.get('/dm/sessions').then(setDmSessions).catch(() => {})

  // 初始加载
  useEffect(() => {
    loadGroups()
    loadDMSessions()
  }, [])

  // 活跃对话变化时刷新
  useEffect(() => {
    loadGroups()
    loadDMSessions()
  }, [activeGroupId, activeSessionId])

  // chat-refresh 事件
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const t = e.detail?.type
      if (t === 'dm_notification' || t === 'unread_update' || t === 'message_sent') {
        loadGroups()
        loadDMSessions()
      }
    }
    window.addEventListener('chat-refresh', handler as EventListener)
    return () => window.removeEventListener('chat-refresh', handler as EventListener)
  }, [])

  // 排序：按 last_message_at 降序（最新在前），无时间戳的排末尾
  const sortByTime = (a: any, b: any) => {
    const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
    const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
    return tb - ta
  }

  // 只显示普通群聊，按最后消息时间排序
  const regularGroups = groups
    .filter((g: any) => !g.name?.startsWith('DM:'))
    .sort(sortByTime)

  // DM 会话按最后消息时间排序
  const sortedDMSessions = [...dmSessions].sort(sortByTime)

  const formatTime = (isoStr: string | null) => {
    if (!isoStr) return ''
    try {
      return new Date(isoStr).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    } catch { return '' }
  }

  const nothingSelected = !activeGroupId && !activeSessionId

  return (
    <div className={`${
      mobileFullscreen ? 'w-full md:w-56' : 'w-56'
    } bg-surface border-r border-border shrink-0 flex-col flex h-full ${
      hideOnMobile && !nothingSelected ? 'hidden' : 'flex'
    } md:flex`}>
      {/* 标题 */}
      <div className="px-3 h-14 border-b border-border font-medium text-sm flex items-center justify-between text-textPrimary shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={openDrawer}
            className="md:hidden p-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
            title="菜单"
          >
            <Menu size={18} />
          </button>
          <span>聊天</span>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowPlusMenu(!showPlusMenu)}
            className="p-1 rounded-lg hover:bg-elevated text-textMuted hover:text-primary-400 transition-colors"
            title="新建"
          >
            <Plus size={16} />
          </button>
          {showPlusMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowPlusMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-36 bg-elevated border border-border rounded-xl shadow-xl z-50 py-1 overflow-hidden">
                <button
                  onClick={() => { setShowPlusMenu(false); onCreateGroup() }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-textSecondary hover:bg-canvas hover:text-textPrimary transition-colors"
                >
                  <Users size={15} />
                  创建群聊
                </button>
                <button
                  onClick={() => { setShowPlusMenu(false); navigate('/friends') }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-textSecondary hover:bg-canvas hover:text-textPrimary transition-colors"
                >
                  <UserPlus size={15} />
                  添加好友
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {/* ── 群聊 ── */}
        <div className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-textMuted">
          群聊
        </div>
        {regularGroups.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-textMuted">
            暂无群聊，点击 + 新建
          </div>
        ) : (
          regularGroups.map((g) => (
            <button
              key={`group-${g.id}`}
              onClick={() => {
                if (g.id === activeGroupId && mobileFullscreen) {
                  onMobileBack?.()
                } else {
                  navigate(`/chat/${g.id}`)
                }
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-all duration-150 ${
                g.id === activeGroupId
                  ? 'bg-primary-500/15 text-primary-600 dark:text-primary-300 border-l-2 border-primary-400'
                  : 'hover:bg-elevated text-textSecondary border-l-2 border-transparent'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium truncate"># {g.name}</div>
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
              <div className="text-[11px] text-textMuted mt-0.5 flex items-center gap-1 min-w-0">
                {g.dnd_until && <BellOff size={10} className="text-rose-400 shrink-0" />}
                {g.has_mention && !g.dnd_until && (
                  <span className="text-rose-400 font-medium shrink-0">[@你]</span>
                )}
                <span className="truncate min-w-0 flex-1">{g.last_message_preview || '暂无消息'}</span>
              </div>
            </button>
          ))
        )}

        {/* ── 私信 ── */}
        {sortedDMSessions.length > 0 && (
          <>
            <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-textMuted">
              私信
            </div>
            {sortedDMSessions.map((s) => (
              <button
                key={`dm-${s.session_id}`}
                onClick={() => {
                  if (s.session_id === activeSessionId && mobileFullscreen) {
                    onMobileBack?.()
                  } else {
                    navigate(`/chat/dm/${s.session_id}`)
                  }
                }}
                className={`w-full text-left px-3 py-2 text-sm transition-all duration-150 ${
                  s.session_id === activeSessionId
                    ? 'bg-primary-500/15 text-primary-600 dark:text-primary-300 border-l-2 border-primary-400'
                    : 'hover:bg-elevated text-textSecondary border-l-2 border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium truncate flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${getStateDotColor(s.partner.state)}`} />
                    <span className="truncate">{s.partner.name}</span>
                  </div>
                  {s.unread_count > 0 && (
                    <span className="shrink-0 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-primary-500/80">
                      {s.unread_count > 99 ? '99+' : s.unread_count}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-textMuted mt-0.5 flex items-center gap-1 min-w-0">
                  {s.partner.type === 'ai' && <span className="text-[10px] shrink-0">🤖</span>}
                  <span className="truncate min-w-0 flex-1">
                    {s.last_message_preview || '暂无消息'}
                  </span>
                  {s.last_message_at && (
                    <span className="shrink-0">{formatTime(s.last_message_at)}</span>
                  )}
                </div>
              </button>
            ))}
          </>
        )}

      </div>

    </div>
  )
}
