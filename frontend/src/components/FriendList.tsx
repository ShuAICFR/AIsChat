import { useState, useEffect } from 'react'
import { UserX, Loader2 } from 'lucide-react'
import { api } from '../api/client'

interface Friend {
  id: number
  friend_type: string
  friend_id: number
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
      case 'active': return 'bg-green-500'
      case 'dnd': return 'bg-red-500'
      case 'offline': return 'bg-gray-400'
      default: return 'bg-gray-300'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-gray-400" size={20} />
      </div>
    )
  }

  if (friends.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
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
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-750 text-left transition-colors group"
        >
          {/* 头像 */}
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
            friend.friend_type === 'human'
              ? 'bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-300'
              : 'bg-green-100 dark:bg-green-800 text-green-600 dark:text-green-300'
          }`}>
            {friend.friend_name.charAt(0).toUpperCase()}
          </div>

          {/* 信息 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                {friend.friend_name}
              </span>
              {friend.state && (
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getStateColor(friend.state)}`} />
              )}
            </div>
            <span className="text-xs text-gray-400">
              {friend.friend_type === 'ai' ? 'AI' : '用户'}
            </span>
          </div>

          {/* 删除按钮 */}
          <button
            onClick={(e) => handleRemove(friend, e)}
            className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
            title="删除好友"
          >
            <UserX size={14} />
          </button>
        </button>
      ))}
    </div>
  )
}
