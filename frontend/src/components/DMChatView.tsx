import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import ChatView from './ChatView'
import DMSettingsPanel from './DMSettingsPanel'
import { ArrowLeft, Bell, BellOff, Settings } from 'lucide-react'

interface DMChatViewProps {
  sessionId: string
  onMobileBack?: () => void
}

export default function DMChatView({ sessionId, onMobileBack }: DMChatViewProps) {
  const [partner, setPartner] = useState<{ id: number; name: string; type: string; state: string | null } | null>(null)
  const [myDndUntil, setMyDndUntil] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
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
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 私信头部 — 与群聊头部布局对齐 */}
      <div className="px-4 h-14 border-b border-border bg-surface flex items-center gap-2 shrink-0">
        {/* 移动端：打开会话列表 */}
        <button
          onClick={() => onMobileBack ? onMobileBack() : navigate('/chat')}
          className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
          title="会话列表"
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
          </div>
          <span className="text-[10px] text-textMuted">
            {partner?.type === 'ai' ? '🤖 AI' : '👤 用户'}
            {partner?.state === 'active' && ' · 在线'}
            {partner?.state === 'dnd' && ' · 免打扰'}
            {(!partner?.state || partner?.state === 'offline') && ' · 离线'}
          </span>
        </div>

        {/* 在线状态指示 */}
        <span className="inline-flex items-center gap-1 text-[10px] text-mint-400 font-medium">
          <span className={`w-1.5 h-1.5 rounded-full ${stateColor}`} />
          {partner?.state === 'active' ? '在线' : partner?.state === 'dnd' ? '勿扰' : '离线'}
        </span>

        {/* 免打扰按钮 */}
        <button
          onClick={handleToggleDnd}
          className={`p-1 rounded-lg transition-colors ${
            myDndUntil
              ? 'text-rose-400 hover:bg-rose-400/10'
              : 'text-textMuted hover:text-rose-400 hover:bg-elevated'
          }`}
          title={myDndUntil ? '取消免打扰' : '开启免打扰'}
        >
          {myDndUntil ? <BellOff size={14} /> : <Bell size={14} />}
        </button>

        {/* 设置按钮（与群聊头部的 Settings 对齐） */}
        <button
          onClick={() => setShowSettings(true)}
          className="p-1 rounded-lg hover:bg-elevated text-textMuted hover:text-textSecondary transition-colors"
          title="私信设置"
        >
          <Settings size={14} />
        </button>
      </div>

      {/* 共享对话框 */}
      <ChatView conversationType="dm" conversationId={sessionId} />

      {/* 私信设置面板 */}
      {showSettings && (
        <DMSettingsPanel
          sessionId={sessionId}
          partner={partner}
          myDndUntil={myDndUntil}
          onClose={() => setShowSettings(false)}
          onDndChange={(dndUntil) => setMyDndUntil(dndUntil)}
        />
      )}
    </div>
  )
}
