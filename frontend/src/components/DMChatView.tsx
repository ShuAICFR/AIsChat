import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import ChatView from './ChatView'
import { ArrowLeft, Bell, BellOff } from 'lucide-react'

interface DMChatViewProps {
  sessionId: string
}

export default function DMChatView({ sessionId }: DMChatViewProps) {
  const [partner, setPartner] = useState<{ id: number; name: string; type: string; state: string | null } | null>(null)
  const [myDndUntil, setMyDndUntil] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!sessionId) return
    api.get(`/dm/${sessionId}`).then((data) => {
      setPartner(data.partner)
      setMyDndUntil(data.my_dnd_until || null)
    }).catch(console.error)
  }, [sessionId])

  const handleToggleDnd = async () => {
    try {
      if (myDndUntil) {
        await api.post(`/dm/${sessionId}/dnd/cancel`)
        setMyDndUntil(null)
      } else {
        await api.post(`/dm/${sessionId}/dnd`, { duration_minutes: null })
        setMyDndUntil('permanent')
      }
    } catch { /* ignore */ }
  }

  const stateColor = partner?.state === 'active' ? 'bg-mint-400' :
    partner?.state === 'dnd' ? 'bg-rose-400' : 'bg-[#6B7280]'

  return (
    <div className="h-full flex flex-col">
      {/* 私信头部 */}
      <div className="px-4 h-14 border-b border-border bg-surface flex items-center gap-3 shrink-0">
        <button
          onClick={() => navigate('/chat')}
          className="p-1.5 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
        >
          <ArrowLeft size={20} />
        </button>

        {/* 对方头像 */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-mint-400 to-emerald-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
          {partner?.name?.charAt(0)?.toUpperCase() || '?'}
        </div>

        {/* 对方信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-textPrimary text-sm truncate">
              {partner?.name || '加载中...'}
            </span>
            <span className={`w-2 h-2 rounded-full shrink-0 ${stateColor}`} />
          </div>
          <span className="text-[10px] text-textMuted">
            {partner?.type === 'ai' ? '🤖 AI' : '👤 用户'}
            {partner?.state === 'active' && ' · 在线'}
            {partner?.state === 'dnd' && ' · 免打扰'}
            {(!partner?.state || partner?.state === 'offline') && ' · 离线'}
          </span>
        </div>

        {/* 免打扰按钮 */}
        <button
          onClick={handleToggleDnd}
          className={`p-1.5 rounded-lg transition-colors ${
            myDndUntil
              ? 'text-rose-400 hover:bg-rose-400/10'
              : 'text-textMuted hover:text-textSecondary hover:bg-elevated'
          }`}
          title={myDndUntil ? '取消免打扰' : '开启免打扰'}
        >
          {myDndUntil ? <BellOff size={16} /> : <Bell size={16} />}
        </button>
      </div>

      {/* 共享对话框 */}
      <ChatView conversationType="dm" conversationId={sessionId} />
    </div>
  )
}
