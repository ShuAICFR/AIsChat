import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Users, MessageSquare, Menu, UserPlus, Check, X, Search, ArrowUpDown, ArrowLeft } from 'lucide-react'

interface Friend {
  friend_type: string
  friend_id: number
  friend_name: string
  state: string | null
  created_at: string | null
  last_dm_at: string | null
  friend_user_id?: number | null
}

interface FriendRequest {
  id: number
  requester_id: number
  requester_name: string | null
  target_type: string
  target_id: number
  target_name: string | null
  status: string
  direction: string | null
  message: string | null
  created_at: string | null
}

type Tab = 'friends' | 'requests'
type SortMode = 'smart' | 'alpha' | 'recent_chat' | 'added_time'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'smart', label: '智能排序' },
  { value: 'alpha', label: '首字母' },
  { value: 'recent_chat', label: '最近聊天' },
  { value: 'added_time', label: '加好友时间' },
]

// 状态权重：在线 > 勿扰 > 离线
function stateWeight(s: string | null): number {
  switch (s) {
    case 'active': return 0
    case 'dnd': return 1
    default: return 2
  }
}

// 类型权重：人类 > AI
function typeWeight(t: string): number {
  return t === 'human' ? 0 : 1
}

function sortFriends(friends: Friend[], mode: SortMode): Friend[] {
  const list = [...friends]
  switch (mode) {
    case 'smart':
      // 在线在前 → 人类在前 → 字典序（中文首字母）
      list.sort((a, b) => {
        const s = stateWeight(a.state) - stateWeight(b.state)
        if (s !== 0) return s
        const t = typeWeight(a.friend_type) - typeWeight(b.friend_type)
        if (t !== 0) return t
        return a.friend_name.localeCompare(b.friend_name, 'zh-CN')
      })
      break
    case 'alpha':
      // 纯字典序
      list.sort((a, b) => a.friend_name.localeCompare(b.friend_name, 'zh-CN'))
      break
    case 'recent_chat':
      // 最近聊天时间越近越顶（无时间的排末尾）
      list.sort((a, b) => {
        const ta = a.last_dm_at ? new Date(a.last_dm_at).getTime() : 0
        const tb = b.last_dm_at ? new Date(b.last_dm_at).getTime() : 0
        return tb - ta
      })
      break
    case 'added_time':
      // 加好友时间越新越顶
      list.sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0
        return tb - ta
      })
      break
  }
  return list
}

export default function FriendsPage() {
  const [friends, setFriends] = useState<Friend[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('friends')
  const [sortMode, setSortMode] = useState<SortMode>('smart')
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const { user } = useAuth()
  const navigate = useNavigate()
  const { openDrawer } = useOutletContext<{ openDrawer: () => void }>()

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [friendsRes, reqRes] = await Promise.all([
        api.get<Friend[]>('/friends'),
        api.get<FriendRequest[]>('/friends/requests'),
      ])
      setFriends(friendsRes)
      setRequests(reqRes.filter(r => r.status === 'pending'))
    } catch (err) {
      console.error('加载好友数据失败:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleStartDM = async (friendType: string, friendId: number, friendUserId?: number | null) => {
    try {
      const targetUserId = friendUserId || friendId
      const dm = await api.post(`/dm/${targetUserId}`)
      if (dm.session_id) {
        navigate(`/chat/dm/${dm.session_id}`)
      }
    } catch (err: any) {
      console.error('创建私信失败:', err)
    }
  }

  const handleAccept = async (requestId: number) => {
    try {
      await api.post(`/friends/requests/${requestId}/accept`)
      loadAll()
    } catch (err: any) {
      console.error('接受好友申请失败:', err)
    }
  }

  const handleReject = async (requestId: number) => {
    try {
      await api.post(`/friends/requests/${requestId}/reject`)
      loadAll()
    } catch (err: any) {
      console.error('拒绝好友申请失败:', err)
    }
  }

  const handleCancelSent = async (requestId: number) => {
    try {
      await api.post(`/friends/requests/${requestId}/reject`)
      loadAll()
    } catch (err: any) {
      console.error('撤回好友申请失败:', err)
    }
  }

  // 拆分收到和发出的申请
  const receivedRequests = requests.filter(r => r.direction === 'received')
  const sentRequests = requests.filter(r => r.direction === 'sent')
  const pendingCount = receivedRequests.length

  const stateIcon = (s: string | null) => {
    switch (s) {
      case 'active': return <span className="w-2 h-2 rounded-full bg-mint-400 shrink-0" />
      case 'dnd': return <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
      default: return <span className="w-2 h-2 rounded-full bg-[#6B7280] shrink-0" />
    }
  }

  const pendingCount = requests.length

  // 排序 + 搜索过滤
  const sortedFriends = useMemo(() => {
    const sorted = sortFriends(friends, sortMode)
    if (!searchQuery.trim()) return sorted
    const q = searchQuery.trim().toLowerCase()
    return sorted.filter(f => f.friend_name.toLowerCase().includes(q))
  }, [friends, sortMode, searchQuery])

  // 搜索框组件（复用）
  const searchBox = (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="搜索好友..."
        className="w-full pl-9 pr-8 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
        autoFocus={showSearch}
      />
      {searchQuery && (
        <button
          onClick={() => setSearchQuery('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-textMuted hover:text-textSecondary"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )

  return (
    <div className="h-full flex flex-col bg-canvas">
      {/* 头部 */}
      <div className="px-4 h-14 border-b border-border bg-surface flex items-center gap-2 shrink-0">
        <button
          onClick={openDrawer}
          className="p-1.5 rounded-lg hover:bg-elevated text-textSecondary transition-colors md:hidden"
        >
          <Menu size={18} />
        </button>
        <h1 className="font-semibold text-textPrimary text-sm flex items-center gap-2">
          <Users size={16} className="text-primary-400 hidden md:inline" />
          {tab === 'friends' ? '好友列表' : '好友申请'}
        </h1>

        {/* 排序 + 搜索按钮（仅好友列表 Tab） */}
        {tab === 'friends' && friends.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            {/* 排序下拉 */}
            <div className="relative">
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="appearance-none pl-2 pr-6 py-1 rounded-lg border border-border bg-canvas text-[11px] text-textSecondary focus:outline-none focus:ring-1 focus:ring-primary-500/50 cursor-pointer"
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ArrowUpDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-textMuted pointer-events-none" />
            </div>
            {/* 搜索按钮 */}
            <button
              onClick={() => setShowSearch(true)}
              className="p-1.5 rounded-lg hover:bg-elevated text-textMuted hover:text-textSecondary transition-colors"
              title="搜索好友"
            >
              <Search size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Tab 切换 */}
      <div className="flex border-b border-border bg-surface shrink-0">
        <button
          onClick={() => setTab('friends')}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
            tab === 'friends'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-textMuted hover:text-textSecondary'
          }`}
        >
          好友列表
        </button>
        <button
          onClick={() => setTab('requests')}
          className={`flex-1 py-2.5 text-xs font-medium transition-colors relative ${
            tab === 'requests'
              ? 'text-primary-400 border-b-2 border-primary-400'
              : 'text-textMuted hover:text-textSecondary'
          }`}
        >
          好友申请
          {pendingCount > 0 && (
            <span className="absolute top-1 right-4 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-rose-500 rounded-full">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto pb-[var(--safe-bottom)] md:pb-0">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500" />
          </div>
        ) : tab === 'friends' ? (
          /* 好友列表 */
          friends.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-textMuted">
              <Users size={40} className="mb-3 opacity-30" />
              <p className="text-sm">暂无好友</p>
              <p className="text-xs mt-1">在群聊中点击头像即可添加好友</p>
            </div>
          ) : sortedFriends.length === 0 && searchQuery ? (
            <div className="flex flex-col items-center justify-center py-20 text-textMuted">
              <Search size={40} className="mb-3 opacity-30" />
              <p className="text-sm">未找到匹配的好友</p>
              <p className="text-xs mt-1">试试其他关键词</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {sortedFriends.map((f) => (
                <button
                  key={`${f.friend_type}:${f.friend_id}`}
                  onClick={() => handleStartDM(f.friend_type, f.friend_id, f.friend_user_id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-elevated transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center text-lg shrink-0">
                    {f.friend_name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-textPrimary truncate">
                        {f.friend_name}
                      </span>
                      {stateIcon(f.state)}
                    </div>
                    <span className="text-xs text-textMuted">
                      {f.friend_type === 'ai' ? '🤖 AI' : '👤 人类'}
                    </span>
                  </div>
                  <MessageSquare size={16} className="text-textMuted shrink-0" />
                </button>
              ))}
            </div>
          )
        ) : (
          /* 好友申请 */
          receivedRequests.length === 0 && sentRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-textMuted">
              <UserPlus size={40} className="mb-3 opacity-30" />
              <p className="text-sm">暂无待处理的好友申请</p>
              <p className="text-xs mt-1">当有人加你为好友时，会显示在这里</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {/* 收到的申请 */}
              {receivedRequests.map((req) => (
                <div key={`recv-${req.id}`} className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center text-lg shrink-0">
                      {req.requester_name?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-textPrimary truncate">
                          {req.requester_name || `用户${req.requester_id}`}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-400 shrink-0">收到</span>
                      </div>
                      <span className="text-xs text-textMuted">
                        {req.message || '请求添加你为好友'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleAccept(req.id)}
                        className="p-1.5 rounded-lg bg-mint-400/15 text-mint-400 hover:bg-mint-400/25 transition-colors"
                        title="接受"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={() => handleReject(req.id)}
                        className="p-1.5 rounded-lg bg-rose-400/15 text-rose-400 hover:bg-rose-400/25 transition-colors"
                        title="拒绝"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {/* 发出的申请 */}
              {sentRequests.map((req) => (
                <div key={`sent-${req.id}`} className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-500/20 to-accent-700/20 flex items-center justify-center text-lg shrink-0">
                      {req.target_name?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-textPrimary truncate">
                          {req.target_name || `用户${req.target_id}`}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-500/10 text-accent-400 shrink-0">待回复</span>
                      </div>
                      <span className="text-xs text-textMuted">
                        {req.message || '你发送了好友申请'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleCancelSent(req.id)}
                        className="p-1.5 rounded-lg bg-rose-400/15 text-rose-400 hover:bg-rose-400/25 transition-colors"
                        title="撤回申请"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* ── 搜索弹窗 ── */}
      {showSearch && (
        <>
          {/* 移动端：全屏 */}
          <div className="md:hidden fixed inset-0 z-50 bg-surface flex flex-col">
            <div className="px-4 h-14 border-b border-border flex items-center gap-3 shrink-0">
              <button
                onClick={() => { setShowSearch(false); setSearchQuery('') }}
                className="p-1.5 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="flex-1">
                {searchBox}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-border/50 pb-[var(--safe-bottom)]">
              {sortedFriends.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-textMuted">
                  <Search size={40} className="mb-3 opacity-30" />
                  <p className="text-sm">未找到匹配的好友</p>
                </div>
              ) : (
                sortedFriends.map((f) => (
                  <button
                    key={`${f.friend_type}:${f.friend_id}`}
                    onClick={() => {
                      setShowSearch(false)
                      setSearchQuery('')
                      handleStartDM(f.friend_type, f.friend_id, f.friend_user_id)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-elevated transition-colors text-left"
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center text-lg shrink-0">
                      {f.friend_name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-textPrimary truncate">{f.friend_name}</span>
                        {stateIcon(f.state)}
                      </div>
                      <span className="text-xs text-textMuted">
                        {f.friend_type === 'ai' ? '🤖 AI' : '👤 人类'}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 桌面端：悬浮下拉 */}
          <div className="hidden md:block fixed inset-0 z-50" onClick={() => { setShowSearch(false); setSearchQuery('') }}>
            <div
              className="absolute top-[4.5rem] left-1/2 -translate-x-1/2 w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-elevated border border-border rounded-2xl shadow-2xl shadow-black/30 mx-4 overflow-hidden">
                <div className="p-3">
                  {searchBox}
                </div>
                {searchQuery.trim() && (
                  <div className="max-h-64 overflow-y-auto border-t border-border divide-y divide-border/50">
                    {sortedFriends.length === 0 ? (
                      <div className="py-6 text-center text-xs text-textMuted">无匹配结果</div>
                    ) : (
                      sortedFriends.slice(0, 8).map((f) => (
                        <button
                          key={`${f.friend_type}:${f.friend_id}`}
                          onClick={() => {
                            setShowSearch(false)
                            setSearchQuery('')
                            handleStartDM(f.friend_type, f.friend_id, f.friend_user_id)
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-canvas transition-colors text-left"
                        >
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center text-sm shrink-0">
                            {f.friend_name.charAt(0)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-textPrimary truncate">{f.friend_name}</span>
                              {stateIcon(f.state)}
                            </div>
                            <span className="text-[10px] text-textMuted">
                              {f.friend_type === 'ai' ? '🤖 AI' : '👤 人类'}
                            </span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
