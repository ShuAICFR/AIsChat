import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Users, MessageSquare, ChevronRight, Menu } from 'lucide-react'
import { useOutletContext } from 'react-router-dom'

interface Friend {
  friend_type: string
  friend_id: number
  friend_name: string
  state: string | null
}

export default function FriendsPage() {
  const [friends, setFriends] = useState<Friend[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const { openDrawer } = useOutletContext<{ openDrawer: () => void }>()

  useEffect(() => {
    api.get<Friend[]>('/friends')
      .then(setFriends)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleStartDM = async (friendType: string, friendId: number) => {
    try {
      const dm = await api.post(`/dm/${friendType}/${friendId}`)
      if (dm.group_id) {
        navigate(`/chat/${dm.group_id}`)
      }
    } catch (err: any) {
      console.error('创建私信失败:', err)
    }
  }

  const stateIcon = (s: string | null) => {
    switch (s) {
      case 'active': return <span className="w-2 h-2 rounded-full bg-mint-400 shrink-0" />
      case 'dnd': return <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
      default: return <span className="w-2 h-2 rounded-full bg-[#6B7280] shrink-0" />
    }
  }

  return (
    <div className="h-full flex flex-col bg-canvas">
      {/* 头部 */}
      <div className="px-4 h-14 border-b border-border bg-surface flex items-center gap-2 shrink-0">
        <button
          onClick={openDrawer}
          className="p-1.5 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
        >
          <Menu size={18} />
        </button>
        <h1 className="font-semibold text-textPrimary text-sm flex items-center gap-2">
          <Users size={16} className="text-primary-400" />
          好友列表
        </h1>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500" />
          </div>
        ) : friends.length === 0 ? (
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
                onClick={() => handleStartDM(f.friend_type, f.friend_id)}
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
        )}
      </div>
    </div>
  )
}
