import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Users, MessageSquare, ChevronRight, Menu, UserPlus, Check, X, Clock } from 'lucide-react'
import { useOutletContext } from 'react-router-dom'

interface Friend {
  friend_type: string
  friend_id: number
  friend_name: string
  state: string | null
}

interface FriendRequest {
  id: number
  requester_id: number
  requester_name: string | null
  target_type: string
  target_id: number
  status: string
  message: string | null
  created_at: string | null
}

type Tab = 'friends' | 'requests'

export default function FriendsPage() {
  const [friends, setFriends] = useState<Friend[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('friends')
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

  const handleStartDM = async (friendType: string, friendId: number, friendUserId?: number) => {
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

  const stateIcon = (s: string | null) => {
    switch (s) {
      case 'active': return <span className="w-2 h-2 rounded-full bg-mint-400 shrink-0" />
      case 'dnd': return <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
      default: return <span className="w-2 h-2 rounded-full bg-[#6B7280] shrink-0" />
    }
  }

  // 待处理申请数量
  const pendingCount = requests.length

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
          <Users size={16} className="text-primary-400" />
          {tab === 'friends' ? '好友列表' : '好友申请'}
        </h1>
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
      <div className="flex-1 overflow-y-auto">
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
          ) : (
            <div className="divide-y divide-border/50">
              {friends.map((f) => (
                <button
                  key={`${f.friend_type}:${f.friend_id}`}
                  onClick={() => handleStartDM(f.friend_type, f.friend_id, (f as any).friend_user_id)}
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
          requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-textMuted">
              <UserPlus size={40} className="mb-3 opacity-30" />
              <p className="text-sm">暂无待处理的好友申请</p>
              <p className="text-xs mt-1">当有人加你为好友时，会显示在这里</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {requests.map((req) => (
                <div
                  key={req.id}
                  className="px-4 py-3.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500/20 to-primary-700/20 flex items-center justify-center text-lg shrink-0">
                      {req.requester_name?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-textPrimary truncate">
                          {req.requester_name || `用户${req.requester_id}`}
                        </span>
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
            </div>
          )
        )}
      </div>
    </div>
  )
}
