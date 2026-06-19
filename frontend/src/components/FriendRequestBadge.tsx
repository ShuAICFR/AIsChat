import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserPlus, Check, X, Loader2, Bell, ExternalLink } from 'lucide-react'
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
  const [toast, setToast] = useState<string | null>(null)
  const prevReceivedRef = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const loadRequests = useCallback(async () => {
    try {
      const data = await api.get<FriendRequest[]>('/friends/requests?status_filter=pending')
      const newReceived = data.filter(r => r.direction === 'received').length
      // 首次加载不计入 toast，后续新增才弹通知
      if (prevReceivedRef.current > 0 && newReceived > prevReceivedRef.current) {
        const delta = newReceived - prevReceivedRef.current
        setToast(`收到 ${delta} 条新好友申请`)
        setTimeout(() => setToast(null), 4000)
      }
      prevReceivedRef.current = newReceived
      setRequests(data)
    } catch (err) {
      console.error('加载好友申请失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // 初始加载 + 每 30 秒轮询
  useEffect(() => {
    loadRequests()
    const interval = setInterval(loadRequests, 30000)
    return () => clearInterval(interval)
  }, [loadRequests])

  // 点击外部关闭面板
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false)
      }
    }
    if (showPanel) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [showPanel])

  const handleAccept = async (req: FriendRequest) => {
    try {
      await api.post(`/friends/requests/${req.id}/accept`)
      setRequests(prev => prev.filter(r => r.id !== req.id))
      prevReceivedRef.current = Math.max(0, prevReceivedRef.current - 1)
    } catch (err: any) {
      alert(err.message || '操作失败')
    }
  }

  const handleReject = async (req: FriendRequest) => {
    try {
      await api.post(`/friends/requests/${req.id}/reject`)
      setRequests(prev => prev.filter(r => r.id !== req.id))
      prevReceivedRef.current = Math.max(0, prevReceivedRef.current - 1)
    } catch (err: any) {
      alert(err.message || '操作失败')
    }
  }

  const handleGoToFriends = () => {
    setShowPanel(false)
    navigate('/friends')
  }

  const receivedCount = requests.filter(r => r.direction === 'received').length

  return (
    <div className="relative" ref={panelRef}>
      {/* Toast 通知 */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-elevated border border-rose-400/30 rounded-xl shadow-2xl shadow-black/30">
            <Bell size={14} className="text-rose-400" />
            <span className="text-sm text-textPrimary">{toast}</span>
          </div>
        </div>
      )}

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
        <div className="absolute top-full right-0 mt-2 w-80 bg-elevated border border-border rounded-xl shadow-2xl shadow-black/30 z-50">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-textPrimary">好友申请</h3>
            <button
              onClick={handleGoToFriends}
              className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 transition-colors"
            >
              查看全部 <ExternalLink size={10} />
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto">
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
                        {req.message && (
                          <span className="italic ml-1">— "{req.message.slice(0, 30)}{req.message.length > 30 ? '...' : ''}"</span>
                        )}
                      </div>
                    </div>

                    {req.direction === 'received' && (
                      <div className="flex gap-1.5 ml-2 shrink-0">
                        <button
                          onClick={() => handleAccept(req)}
                          className="px-2.5 py-1 rounded-lg bg-mint-400/15 text-mint-400 hover:bg-mint-400/25 transition-colors text-xs font-medium"
                        >
                          接受
                        </button>
                        <button
                          onClick={() => handleReject(req)}
                          className="px-2.5 py-1 rounded-lg bg-rose-400/10 text-rose-400 hover:bg-rose-400/20 transition-colors text-xs font-medium"
                        >
                          拒绝
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
