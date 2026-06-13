import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { useAuth } from '../context/AuthContext'

/** 将 UTC 时间字符串转为用户时区显示 */
function formatTime(utcStr: string, timezone: string): string {
  try {
    // 后端返回 "2026-06-13 15:28:00" 格式的 UTC 时间
    const isoStr = utcStr.replace(' ', 'T') + 'Z'
    return new Date(isoStr).toLocaleTimeString('zh-CN', {
      hour: '2-digit', minute: '2-digit', timeZone: timezone,
    })
  } catch {
    return utcStr
  }
}

interface MessageBubbleProps {
  senderName: string
  content: string
  isHuman: boolean
  createdAt: string
  state?: string
  senderType?: string
  senderId?: number
  onAvatarClick?: (type: string, id: number, name: string, state?: string) => void
}

export default function MessageBubble({
  senderName, content, isHuman, createdAt, state,
  senderType, senderId, onAvatarClick,
}: MessageBubbleProps) {
  const { user } = useAuth()
  const tz = user?.timezone || 'Asia/Shanghai'

  const getStateIcon = (s?: string) => {
    switch (s) {
      case 'active': return '🟢'
      case 'dnd': return '🔴'
      case 'offline': return '⚫'
      default: return ''
    }
  }

  const bubbleColor = isHuman
    ? 'bg-primary-500 text-white rounded-tr-sm'
    : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-tl-sm shadow-sm border border-gray-100 dark:border-gray-600'

  return (
    <div className={`flex gap-3 mb-4 ${isHuman ? 'flex-row-reverse' : ''}`}>
      {/* 头像 */}
      <div
        onClick={() => {
          if (onAvatarClick && senderType && senderId) {
            onAvatarClick(senderType, senderId, senderName, state)
          }
        }}
        className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 cursor-pointer hover:ring-2 hover:ring-primary-300 transition-all ${
          isHuman
            ? 'bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-300'
            : 'bg-green-100 dark:bg-green-800 text-green-600 dark:text-green-300'
        }`}
        title="点击查看资料"
      >
        {senderName.charAt(0).toUpperCase()}
      </div>

      {/* 消息内容 */}
      <div className={`max-w-[70%] ${isHuman ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {senderName}
          </span>
          {state && (
            <span className="text-xs" title={state}>{getStateIcon(state)}</span>
          )}
          <span className="text-xs text-gray-400">
            {formatTime(createdAt, tz)}
          </span>
        </div>
        <div className={`rounded-2xl px-4 py-2 text-sm leading-relaxed ${bubbleColor}`}>
          {isHuman ? (
            <span className="whitespace-pre-wrap">{content}</span>
          ) : (
            <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {content}
            </Markdown>
          )}
        </div>
      </div>
    </div>
  )
}
