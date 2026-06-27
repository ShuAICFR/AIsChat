import { useState, useEffect, useCallback } from 'react'
import { Download, X, ArrowLeft, FileIcon, Loader2, AlertTriangle } from 'lucide-react'
import { useT } from '../i18n/I18nContext'

/** 可直接文本预览的 MIME 类型 */
function isTextPreviewable(mimeType: string): boolean {
  if (mimeType.startsWith('text/')) return true
  const textish = [
    'application/json',
    'application/xml',
    'application/javascript',
    'application/x-yaml',
    'application/x-sh',
    'application/x-shellscript',
  ]
  return textish.includes(mimeType)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

interface FilePreviewModalProps {
  fileId: number
  fileName: string
  fileSize: number
  mimeType: string
  onClose: () => void
}

export default function FilePreviewModal({ fileId, fileName, fileSize, mimeType, onClose }: FilePreviewModalProps) {
  const t = useT()
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const token = localStorage.getItem('access_token')
  const dlUrl = `/api/fs/download/${fileId}?token=${token || ''}`

  const isImage = mimeType.startsWith('image/')
  const previewable = isImage || isTextPreviewable(mimeType)

  useEffect(() => {
    if (!previewable) {
      // 不可预览 → 直接触发下载
      const a = document.createElement('a')
      a.href = dlUrl
      a.download = fileName
      a.click()
      onClose()
      return
    }

    // 图片：不需要 fetch 内容，直接渲染
    if (isImage) {
      setLoading(false)
      return
    }

    const ac = new AbortController()
    fetch(dlUrl, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        if (text.length > 2 * 1024 * 1024) {
          setContent(text.slice(0, 2 * 1024 * 1024) + '\n\n… 文件过大，仅显示前 2MB')
        } else {
          setContent(text)
        }
        setLoading(false)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message || t('common.loadFailed'))
          setLoading(false)
        }
      })

    return () => ac.abort()
  }, [fileId, previewable, dlUrl, fileName, onClose, t, isImage])

  const handleDownload = useCallback(() => {
    const a = document.createElement('a')
    a.href = dlUrl
    a.download = fileName
    a.click()
  }, [dlUrl, fileName])

  // ── 不可预览：已触发下载，不渲染 ──
  if (!previewable) return null

  const headerBar = (
    <div className="flex items-center gap-3 px-4 h-12 border-b border-border bg-surface shrink-0">
      {/* 移动端返回 / 桌面端关闭 */}
      <button
        onClick={onClose}
        className="p-1 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
        title={t('common.close')}
      >
        <ArrowLeft size={18} className="md:hidden" />
        <X size={18} className="hidden md:block" />
      </button>

      <FileIcon size={18} className="text-textMuted shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-textPrimary truncate">{fileName}</p>
        <p className="text-[10px] text-textMuted">{formatFileSize(fileSize)}</p>
      </div>

      <button
        onClick={handleDownload}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-500 text-white text-xs font-medium hover:bg-primary-400 transition-colors"
        title={t('common.download')}
      >
        <Download size={14} />
        <span className="hidden sm:inline">{t('common.download')}</span>
      </button>
    </div>
  )

  return (
    /* 遮罩 */
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-0 md:p-6" onClick={onClose}>
      {/* 弹窗主体：移动端全屏，桌面端最大宽高 */}
      <div
        className="bg-surface border border-border md:rounded-2xl shadow-2xl shadow-black/30 flex flex-col
                      w-full h-full md:w-[720px] md:max-h-[85vh] md:h-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {headerBar}

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-0 md:p-5 bg-canvas min-h-0 flex items-start justify-center">
          {loading ? (
            <div className="flex items-center justify-center py-20 w-full">
              <Loader2 size={24} className="animate-spin text-textMuted" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-textMuted w-full">
              <AlertTriangle size={24} className="text-rose-400" />
              <p className="text-sm">{error}</p>
              <button onClick={handleDownload} className="px-4 py-2 rounded-xl bg-primary-500 text-white text-sm">
                {t('common.downloadInstead')}
              </button>
            </div>
          ) : isImage ? (
            <img src={dlUrl} alt={fileName} className="w-full h-auto md:max-h-[75vh] object-contain md:rounded-lg" />
          ) : (
            <pre className="w-full text-xs text-textPrimary whitespace-pre-wrap break-all font-mono leading-relaxed select-text p-4 md:p-0">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
