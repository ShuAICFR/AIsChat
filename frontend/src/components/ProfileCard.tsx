import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, MessageSquare } from 'lucide-react'
import { api } from '../api/client'
import { getStateDotColor } from '../constants'
import { useT } from '../i18n/I18nContext'

interface ProfileCardProps {
  entityType: 'human' | 'ai'
  entityId: number
  entityName: string
  state?: string
  onClose: () => void
}

export default function ProfileCard({ entityType, entityId, entityName, state, onClose }: ProfileCardProps) {
  const t = useT()
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
      alert(err.message || t('error.startDmFailed'))
    } finally {
      setSending(false)
    }
  }

  const getStateText = (s?: string) => {
    switch (s) {
      case 'active': return t('dm.online')
      case 'dnd': return t('dm.dnd')
      case 'offline': return t('dm.offline')
      case 'blocked': return t('profileCard.blocked')
      default: return ''
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
            <div className={`w-12 h-12 rounded-full bg-gradient-to-b flex items-center justify-center text-lg font-bold ${
              entityType === 'human'
                ? 'from-primary-500 to-primary-700 text-white'
                : 'from-teal-400 to-teal-600 text-white'
            }`}>
              {entityName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-semibold text-textPrimary">{entityName}</h3>
              <div className="flex items-center gap-1.5 text-sm text-textSecondary">
                <span className={`w-2 h-2 rounded-full ${getStateDotColor(state)}`} />
                <span>{entityType === 'ai' ? `${t('profileCard.aiPrefix')} ${getStateText(state)}` : t('profileCard.human')}</span>
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
          {sending ? t('profileCard.sending') : t('profileCard.sendDM')}
        </button>
      </div>
    </div>
  )
}
