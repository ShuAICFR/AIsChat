import { useState, useEffect } from 'react'
import { UserPlus, Check, X, Loader2 } from 'lucide-react'
import { api } from '../api/client'

interface FriendRequest {
  id: number
  requester_id: number
  requester_name: string
  target_type: string
  target_id: number
  status: string
  message: string | null
  direction: 'received' | 'sent'
  created_at: string | null
}

export default function FriendRequestBadge() {
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [showPanel, setShowPanel] = useState(false)

  const loadRequests = async () => {
    try {
      const data = await api.get<FriendRequest[]>('/friends/requests?status_filter=pending')
      setRequests(data)
    } catch (err) {
      console.error('加载好友申请失败:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRequests()
  }, [])

  const handleAccept = async (req: FriendRequest) => {
    try {
      await api.post(`/friends/requests/${req.id}/accept`)
      setRequests(prev => prev.filter(r => r.id !== req.id))
    } catch (err: any) {
      alert(err.message || '操作失败')
    }
  }

  const handleReject = async (req: FriendRequest) => {
    try {
      await api.post(`/friends/requests/${req.id}/reject`)
      setRequests(prev => prev.filter(r => r.id !== req.id))
    } catch (err: any) {
      alert(err.message || '操作失败')
    }
  }

  const receivedCount = requests.filter(r => r.direction === 'received').length

  return (
    <div className="relative">
      {/* 徽章按钮 */}
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="relative p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors"
        title="好友申请"
      >
        <UserPlus size={16} />
        {receivedCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
            {receivedCount > 9 ? '9+' : receivedCount}
          </span>
        )}
      </button>

      {/* 申请面板 */}
      {showPanel && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50">
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">好友申请</h3>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="animate-spin text-gray-400" size={18} />
              </div>
            ) : requests.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-400">暂无待处理申请</div>
            ) : (
              requests.map((req) => (
                <div key={req.id} className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-750 last:border-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        {req.direction === 'received'
                          ? req.requester_name
                          : `${req.target_type === 'ai' ? 'AI' : '用户'} #${req.target_id}`}
                      </div>
                      <div className="text-xs text-gray-400">
                        {req.direction === 'received' ? '想添加你为好友' : '已发送申请'}
                        {req.message && ` — "${req.message}"`}
                      </div>
                    </div>

                    {req.direction === 'received' && (
                      <div className="flex gap-1 ml-2">
                        <button
                          onClick={() => handleAccept(req)}
                          className="p-1 rounded-md bg-green-50 dark:bg-green-900/30 text-green-600 hover:bg-green-100"
                          title="接受"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => handleReject(req)}
                          className="p-1 rounded-md bg-red-50 dark:bg-red-900/30 text-red-500 hover:bg-red-100"
                          title="拒绝"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
