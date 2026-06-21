import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import rehypeKatex from 'rehype-katex'
import { useAuth } from '../context/AuthContext'
import { getStateDotColor } from '../constants'
import { FileIcon, Download, Globe } from 'lucide-react'
import { formatMessageTime } from '../utils/time'
import { useLang, useT } from '../i18n/I18nContext'
import MermaidBlock from './MermaidBlock'

/** 聊天消息中的 code 渲染：mermaid → MermaidBlock(compact)，其余默认 */
function ChatCodeRenderer({ className, children, inline, ...props }: any) {
  const match = /language-(\w+)/.exec(className || '')
  const code = String(children).replace(/\n$/, '')

  if (!inline && match && match[1] === 'mermaid') {
    return <MermaidBlock code={code} compact />
  }

  if (inline) {
    return <code className={className} {...props}>{children}</code>
  }
  return (
    <pre className={className}>
      <code {...props}>{children}</code>
    </pre>
  )
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
  isTyping?: boolean
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
  senderName, senderAvatarUrl, content, isMine, createdAt, state,
  senderType, senderId, thinking, isTyping, sourcePublicId, attachments, onAvatarClick,
}: MessageBubbleProps) {
  const { user } = useAuth()
  const lang = useLang()
  const t = useT()

  const stateColor = getStateDotColor(state)

  const bubbleBg = isMine
    ? 'bg-primary-600 text-white rounded-2xl rounded-tr-md shadow-lg shadow-primary-500/15'
    : 'bg-surface text-textPrimary rounded-2xl rounded-tl-md border border-border'

  const avatarGradientBase = isMine ? 'from-primary-500 to-primary-700' : 'from-mint-400 to-emerald-600'
  const avatarGradientOpacity = senderAvatarUrl ? '/30' : ''
  const avatarGradientShadow = isMine ? 'shadow-primary-500/25' : 'shadow-mint-400/20'

  return (
    <div className={`flex gap-3 mb-5 msg-enter ${isMine ? 'flex-row-reverse' : ''}`}>
      {/* 头像 — 思考/输入中时带脉动光环 */}
      <div className="relative shrink-0">
        {/* 仅在 AI 思考中/输入中显示脉动 */}
        {!isMine && (thinking || isTyping) && (
          <div className="absolute -inset-0.5 w-10 h-10 rounded-full ai-pulse-active" />
        )}
        {/* 头像 */}
        <div
          onClick={() => {
            if (onAvatarClick && senderType && senderId) {
              onAvatarClick(senderType, senderId, senderName, state)
            }
          }}
          className={`relative w-9 h-9 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-bold cursor-pointer hover:scale-105 transition-transform shadow-lg ${avatarGradientBase}${avatarGradientOpacity} ${avatarGradientShadow}`}
          title={thinking ? t('chat.thinking') : isTyping ? t('chat.typing') : t('chat.viewProfile').replace('{name}', senderName)}
        >
          {(thinking || isTyping) ? (
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
        {!isMine && state && !thinking && !isTyping && (
          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${stateColor} border-2 border-canvas`} />
        )}
      </div>

      {/* 消息内容 */}
      <div className={`max-w-[72%] ${isMine ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-center gap-2 mb-1 flex-wrap ${isMine ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs font-medium text-textSecondary truncate min-w-0">{senderName}</span>
          {sourcePublicId && (
            <span className="text-[10px] text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded-full" title={t('chat.fromInstance').replace('{publicId}', sourcePublicId)}>
              <Globe size={10} className="inline" /> {sourcePublicId.length > 15 ? sourcePublicId.slice(0, 15) + '...' : sourcePublicId}
            </span>
          )}
          <span className="text-[10px] text-textMuted">{formatMessageTime(createdAt, lang)}</span>
          {thinking && (
            <span className="text-[10px] text-primary-400 animate-pulse font-medium">{t('chat.thinking')}</span>
          )}
          {isTyping && (
            <span className="text-[10px] text-mint-400 animate-pulse font-medium">{t('chat.typing')}</span>
          )}
        </div>
        <div className={`px-4 py-2.5 text-sm leading-relaxed break-words ${bubbleBg} ${thinking || isTyping ? 'opacity-70' : ''}
          [&_.katex-display]:overflow-x-auto [&_.katex-display]:-mx-1 [&_.katex-display]:px-1
          [&_pre]:overflow-x-auto [&_pre]:-mx-1 [&_pre]:px-1
          [&_table]:overflow-x-auto [&_table]:block
          [&_img]:max-w-full [&_img]:rounded-lg
          [&_a]:break-all
          [&_code]:break-all [&_pre>code]:break-normal
        `}>
          {isTyping ? (
            <span className="inline-block w-2 h-4 bg-primary-400 rounded-sm animate-pulse align-middle" />
          ) : (
            <Markdown
              remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
              rehypePlugins={[rehypeKatex]}
              components={{ code: ChatCodeRenderer }}
            >
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
