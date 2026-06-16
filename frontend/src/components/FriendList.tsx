import { useState, useEffect } from 'react'
import { UserX, Loader2 } from 'lucide-react'
import { api } from '../api/client'

interface Friend {
  id: number
  friend_type: string
  friend_id: number
  friend_user_id?: number  // v1.1.2: 好友在 users 表中的统一 ID
  friend_name: string
  state: string | null
  created_at: string | null
}

interface FriendListProps {
  onSelectFriend?: (friend: Friend) => void
  refreshTrigger?: number
}

export default function FriendList({ onSelectFriend, refreshTrigger }: FriendListProps) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [loading, setLoading] = useState(true)

  const loadFriends = async () => {
    setLoading(true)
    try {
      const data = await api.get<Friend[]>('/friends')
      setFriends(data)
    } catch (err) {
      console.error('加载好友列表失败:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFriends()
  }, [refreshTrigger])

  const handleRemove = async (friend: Friend, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`确定要删除好友「${friend.friend_name}」吗？`)) return
    try {
      await api.delete(`/friends/${friend.friend_type}/${friend.friend_id}`)
      setFriends(prev => prev.filter(f => f.id !== friend.id))
    } catch (err: any) {
      alert(err.message || '删除失败')
    }
  }

  const getStateColor = (s: string | null) => {
    switch (s) {
      case 'active': return 'bg-mint-400'
      case 'dnd': return 'bg-rose-400'
      case 'offline': return 'bg-[#6B7280]'
      default: return 'bg-border'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-textMuted" size={20} />
      </div>
    )
  }

  if (friends.length === 0) {
    return (
      <div className="text-center py-8 text-textMuted text-sm">
        <p>暂无好友</p>
        <p className="text-xs mt-1">使用顶部搜索框添加好友</p>
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {friends.map((friend) => (
        <button
          key={friend.id}
          onClick={() => onSelectFriend?.(friend)}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-elevated text-left transition-colors group"
        >
          {/* 头像 */}
          <div className={`w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-bold shrink-0 ${
            friend.friend_type === 'human'
              ? 'from-primary-500 to-primary-700 text-white'
              : 'from-mint-400 to-emerald-600 text-white'
          }`}>
            {friend.friend_name.charAt(0).toUpperCase()}
          </div>

          {/* 信息 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-textPrimary truncate">
                {friend.friend_name}
              </span>
              {friend.state && (
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getStateColor(friend.state)}`} />
              )}
            </div>
            <span className="text-xs text-textMuted">
              {friend.friend_type === 'ai' ? 'AI' : '用户'}
            </span>
          </div>

          {/* 删除按钮 */}
          <button
            onClick={(e) => handleRemove(friend, e)}
            className="p-1 rounded-lg hover:bg-rose-400/10 text-textMuted hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all"
            title="删除好友"
          >
            <UserX size={14} />
          </button>
        </button>
      ))}
    </div>
  )
}
