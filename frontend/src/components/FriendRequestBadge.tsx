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
        className="relative p-1.5 rounded-lg hover:bg-elevated text-textMuted hover:text-textSecondary transition-colors"
        title="好友申请"
      >
        <UserPlus size={16} />
        {receivedCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-rose-400 text-white text-[10px] flex items-center justify-center font-bold">
            {receivedCount > 9 ? '9+' : receivedCount}
          </span>
        )}
      </button>

      {/* 申请面板 */}
      {showPanel && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-elevated border border-border rounded-xl shadow-2xl shadow-black/30 z-50">
          <div className="p-3 border-b border-border">
            <h3 className="text-sm font-semibold text-textPrimary">好友申请</h3>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="animate-spin text-textMuted" size={18} />
              </div>
            ) : requests.length === 0 ? (
              <div className="py-6 text-center text-sm text-textMuted">暂无待处理申请</div>
            ) : (
              requests.map((req) => (
                <div key={req.id} className="px-3 py-2.5 border-b border-border last:border-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-textPrimary">
                        {req.direction === 'received'
                          ? req.requester_name
                          : `${req.target_type === 'ai' ? 'AI' : '用户'} #${req.target_id}`}
                      </div>
                      <div className="text-xs text-textMuted">
                        {req.direction === 'received' ? '想添加你为好友' : '已发送申请'}
                        {req.message && ` — "${req.message}"`}
                      </div>
                    </div>

                    {req.direction === 'received' && (
                      <div className="flex gap-1 ml-2">
                        <button
                          onClick={() => handleAccept(req)}
                          className="p-1 rounded-md bg-mint-400/10 text-mint-400 hover:bg-mint-400/20 transition-colors"
                          title="接受"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => handleReject(req)}
                          className="p-1 rounded-md bg-rose-400/10 text-rose-400 hover:bg-rose-400/20 transition-colors"
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
