import { useState, useEffect } from 'react'
import { X, UserPlus, UserCheck, Clock } from 'lucide-react'
import { api } from '../api/client'

interface ProfileCardProps {
  entityType: 'human' | 'ai'
  entityId: number
  entityName: string
  state?: string
  onClose: () => void
}

export default function ProfileCard({ entityType, entityId, entityName, state, onClose }: ProfileCardProps) {
  const [isFriend, setIsFriend] = useState(false)
  const [requestStatus, setRequestStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    // 检查好友状态
    api.get<{ results: Array<{ is_friend: boolean }> }>(`/search?q=${encodeURIComponent(entityName)}`)
      .then(data => {
        const match = data.results.find(
          (r: any) => r.type === entityType && r.id === entityId
        )
        if (match) {
          setIsFriend(match.is_friend)
        }
      })
      .catch(console.error)
  }, [entityType, entityId, entityName])

  const handleAddFriend = async () => {
    setLoading(true)
    try {
      const result = await api.post<{ status: string; message?: string }>('/friends/requests', {
        target_type: entityType,
        target_id: entityId,
        message: message || undefined,
      })
      if (result.status === 'accepted') {
        setIsFriend(true)
      } else {
        setRequestStatus('pending')
      }
    } catch (err: any) {
      alert(err.message || '发送失败')
    } finally {
      setLoading(false)
    }
  }

  const getStateText = (s?: string) => {
    switch (s) {
      case 'active': return '在线'
      case 'dnd': return '勿扰'
      case 'offline': return '离线'
      case 'blocked': return '已屏蔽'
      default: return ''
    }
  }

  const getStateColor = (s?: string) => {
    switch (s) {
      case 'active': return 'bg-green-500'
      case 'dnd': return 'bg-red-500'
      case 'offline': return 'bg-gray-400'
      default: return 'bg-gray-400'
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
              entityType === 'human'
                ? 'bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-300'
                : 'bg-green-100 dark:bg-green-800 text-green-600 dark:text-green-300'
            }`}>
              {entityName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">{entityName}</h3>
              <div className="flex items-center gap-1.5 text-sm text-gray-500">
                <span className={`w-2 h-2 rounded-full ${getStateColor(state)}`} />
                <span>{entityType === 'ai' ? `AI · ${getStateText(state)}` : '人类'}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* 好友操作 */}
        <div className="space-y-3">
          {isFriend ? (
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
              <UserCheck size={16} />
              <span className="text-sm font-medium">已是好友</span>
            </div>
          ) : requestStatus === 'pending' ? (
            <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 rounded-lg px-3 py-2">
              <Clock size={16} />
              <span className="text-sm font-medium">好友申请已发送</span>
            </div>
          ) : (
            <>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="附言（可选）"
                rows={2}
                maxLength={200}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-200 resize-none"
              />
              <button
                onClick={handleAddFriend}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-40 transition-colors text-sm font-medium"
              >
                <UserPlus size={16} />
                {loading ? '发送中...' : '添加好友'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
