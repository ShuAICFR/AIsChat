import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, MessageSquare } from 'lucide-react'
import { api } from '../api/client'

interface ProfileCardProps {
  entityType: 'human' | 'ai'
  entityId: number
  entityName: string
  state?: string
  onClose: () => void
}

export default function ProfileCard({ entityType, entityId, entityName, state, onClose }: ProfileCardProps) {
  const navigate = useNavigate()
  const [sending, setSending] = useState(false)

  const handleSendDM = async () => {
    setSending(true)
    try {
      // 注意：DM API 使用 target_user_id（Human 的 user_id 或 AI 绑定的 user_id）
      const dm = await api.post<{ session_id: string }>(`/dm/${entityId}`)
      if (dm.session_id) {
        onClose()
        navigate(`/chat/dm/${dm.session_id}`)
      }
    } catch (err: any) {
      alert(err.message || '发起私信失败')
    } finally {
      setSending(false)
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
      case 'active': return 'bg-mint-400'
      case 'dnd': return 'bg-rose-400'
      case 'offline': return 'bg-[#6B7280]'
      default: return 'bg-[#6B7280]'
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl shadow-black/30"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center text-lg font-bold ${
              entityType === 'human'
                ? 'from-primary-500 to-primary-700 text-white'
                : 'from-mint-400 to-emerald-600 text-white'
            }`}>
              {entityName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-semibold text-textPrimary">{entityName}</h3>
              <div className="flex items-center gap-1.5 text-sm text-textSecondary">
                <span className={`w-2 h-2 rounded-full ${getStateColor(state)}`} />
                <span>{entityType === 'ai' ? `AI · ${getStateText(state)}` : '人类'}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-textMuted hover:text-textSecondary">
            <X size={20} />
          </button>
        </div>

        {/* 操作区 — 直接发私信 */}
        <button
          onClick={handleSendDM}
          disabled={sending}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary-500 text-white hover:bg-primary-400 disabled:opacity-30 transition-all text-sm font-medium shadow-lg shadow-primary-500/20"
        >
          <MessageSquare size={16} />
          {sending ? '发起中...' : '发私信'}
        </button>
      </div>
    </div>
  )
}
