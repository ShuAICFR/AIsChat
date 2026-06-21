import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { useAuth } from '../context/AuthContext'
import { getStateDotColor } from '../constants'
import { FileIcon, Download, Globe } from 'lucide-react'

function formatTime(utcStr: string, timezone: string): string {
  try {
    const isoStr = utcStr.replace(' ', 'T') + 'Z'
    return new Date(isoStr).toLocaleTimeString('zh-CN', {
      hour: '2-digit', minute: '2-digit', timeZone: timezone,
    })
  } catch { return utcStr }
}

interface MessageBubbleProps {
  senderName: string
  senderAvatarUrl?: string | null
  content: string
  isMine: boolean
  createdAt: string
  state?: string
  senderType?: string
  senderId?: number
  thinking?: boolean
  sourcePublicId?: string | null
  attachments?: Array<{file_id: number, name: string, size: number, mime_type: string}> | null
  onAvatarClick?: (type: string, id: number, name: string, state?: string) => void
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function fileIconColor(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'text-mint-400'
  if (mimeType.startsWith('video/')) return 'text-rose-400'
  if (mimeType.includes('pdf')) return 'text-rose-400'
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('gz')) return 'text-amber-400'
  return 'text-primary-400'
}

export default function MessageBubble({
  senderName, content, isMine, createdAt, state,
  senderType, senderId, thinking, sourcePublicId, attachments, onAvatarClick,
}: MessageBubbleProps) {
  const { user } = useAuth()
  const tz = user?.timezone || 'Asia/Shanghai'

  const stateColor = getStateDotColor(state)

  const bubbleBg = isMine
    ? 'bg-primary-600 text-white rounded-2xl rounded-tr-md shadow-lg shadow-primary-500/15'
    : 'bg-surface text-textPrimary rounded-2xl rounded-tl-md border border-border'

  return (
    <div className={`flex gap-3 mb-5 msg-enter ${isMine ? 'flex-row-reverse' : ''}`}>
      {/* 头像 — 思考时带脉动光环 */}
      <div className="relative shrink-0">
        {/* 仅在 AI 思考中显示脉动 */}
        {!isMine && thinking && (
          <div className="absolute -inset-0.5 w-10 h-10 rounded-full ai-pulse-active" />
        )}
        {/* 头像 */}
        <div
          onClick={() => {
            if (onAvatarClick && senderType && senderId) {
              onAvatarClick(senderType, senderId, senderName, state)
            }
          }}
          className={`relative w-9 h-9 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-bold cursor-pointer hover:scale-105 transition-transform shadow-lg ${
            isMine
              ? 'from-primary-500 to-primary-700 shadow-primary-500/25'
              : 'from-mint-400 to-emerald-600 shadow-mint-400/20'
          }`}
          title={thinking ? `${senderName} 思考中...` : `查看 ${senderName} 资料`}
        >
          {thinking ? (
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 bg-white/80 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 bg-white/80 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 bg-white/80 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          ) : senderAvatarUrl ? (
            <img src={senderAvatarUrl} alt={senderName} className="w-full h-full rounded-full object-cover" />
          ) : (
            senderName.charAt(0).toUpperCase()
          )}
        </div>
        {/* 在线状态点 */}
        {!isMine && state && !thinking && (
          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${stateColor} border-2 border-canvas`} />
        )}
      </div>

      {/* 消息内容 */}
      <div className={`max-w-[72%] ${isMine ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-center gap-2 mb-1 ${isMine ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs font-medium text-textSecondary">{senderName}</span>
          {sourcePublicId && (
            <span className="text-[10px] text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded-full" title={`来自实例: ${sourcePublicId}`}>
              <Globe size={10} className="inline" /> {sourcePublicId.length > 15 ? sourcePublicId.slice(0, 15) + '...' : sourcePublicId}
            </span>
          )}
          <span className="text-[10px] text-textMuted">{formatTime(createdAt, tz)}</span>
          {thinking && (
            <span className="text-[10px] text-primary-400 animate-pulse font-medium">思考中...</span>
          )}
        </div>
        <div className={`px-4 py-2.5 text-sm leading-relaxed ${bubbleBg} ${thinking ? 'opacity-70' : ''}`}>
          {isMine ? (
            <span className="whitespace-pre-wrap">{content}</span>
          ) : (
            <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {content}
            </Markdown>
          )}
          {/* 附件列表 */}
          {attachments && attachments.length > 0 && (
            <div className={`mt-2 pt-2 border-t flex flex-wrap gap-1.5 ${isMine ? 'border-white/20' : 'border-border'}`}>
              {attachments.map((att) => (
                <a
                  key={att.file_id}
                  href={`/api/fs/download/${att.file_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors ${
                    isMine
                      ? 'bg-white/10 hover:bg-white/20 text-white/90'
                      : 'bg-canvas hover:bg-elevated text-textSecondary hover:text-textPrimary border border-border'
                  }`}
                  title={`${att.name} (${formatFileSize(att.size)})`}
                >
                  <FileIcon size={12} className={fileIconColor(att.mime_type)} />
                  <span className="max-w-[100px] truncate">{att.name}</span>
                  <span className="text-[10px] opacity-60">{formatFileSize(att.size)}</span>
                  <Download size={11} className="opacity-60" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
