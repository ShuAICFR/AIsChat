import { useState } from 'react'
import { api } from '../api/client'
import { X, Bell, BellOff, Download, Clock } from 'lucide-react'

interface Partner {
  id: number
  name: string
  type: string
  state: string | null
}

interface Props {
  sessionId: string
  partner: Partner | null
  myDndUntil: string | null
  onClose: () => void
  onDndChange: (dndUntil: string | null) => void
}

const DND_DURATIONS = [
  { label: '15 分钟', minutes: 15 },
  { label: '30 分钟', minutes: 30 },
  { label: '1 小时', minutes: 60 },
  { label: '4 小时', minutes: 240 },
  { label: '8 小时', minutes: 480 },
  { label: '永久', minutes: null as unknown as number },
]

export default function DMSettingsPanel({ sessionId, partner, myDndUntil, onClose, onDndChange }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [customMinutes, setCustomMinutes] = useState('')

  // 导出状态
  const [exportFormat, setExportFormat] = useState('txt')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const handleSetDnd = async (minutes: number | null) => {
    if (!sessionId) return
    setLoading(true)
    setError('')
    try {
      await api.post(`/dm/${sessionId}/dnd`, { duration_minutes: minutes })
      const until = minutes === null ? 'permanent' : new Date(Date.now() + minutes * 60_000).toISOString()
      onDndChange(until)
    } catch (e: any) {
      setError(e?.detail || '设置失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCustomDnd = async () => {
    const mins = parseInt(customMinutes, 10)
    if (isNaN(mins) || mins <= 0) {
      setError('请输入有效的分钟数')
      return
    }
    if (mins > 10080) {
      setError('单次免打扰最长 7 天（10080 分钟）')
      return
    }
    await handleSetDnd(mins)
    setCustomMinutes('')
  }

  const handleCancelDnd = async () => {
    if (!sessionId) return
    setLoading(true)
    setError('')
    try {
      await api.post(`/dm/${sessionId}/dnd/cancel`)
      onDndChange(null)
    } catch (e: any) {
      setError(e?.detail || '取消失败')
    } finally {
      setLoading(false)
    }
  }

  const handleExportChat = async () => {
    if (!sessionId) return
    setExporting(true)
    setExportError('')
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`/api/dm/${sessionId}/export?fmt=${exportFormat}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '导出失败')
      }
      const blob = await res.blob()
      const ext = exportFormat === 'txt' ? 'txt' : exportFormat === 'html' ? 'html' : 'json'
      const filename = `dm_${partner?.name || sessionId}_${new Date().toISOString().slice(0, 10)}.${ext}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setExportError(e.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 点击外部关闭 */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-80 max-w-full h-full bg-surface border-l border-border shadow-2xl flex flex-col animate-slide-in">
        {/* 头部 */}
        <div className="h-14 px-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-sm text-textPrimary">私信设置</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-elevated text-textMuted">
            <X size={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="text-xs text-rose-400 bg-rose-400/10 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* === 免打扰设置 === */}
          <div>
            <h3 className="text-sm font-medium text-textPrimary flex items-center gap-2 mb-3">
              <Bell size={14} className="text-textMuted" />
              消息免打扰
            </h3>

            {myDndUntil ? (
              <div className="space-y-3">
                <div className="bg-mint-400/10 text-mint-400 rounded-lg px-3 py-2 text-xs flex items-center gap-2">
                  <BellOff size={14} />
                  免打扰已开启
                </div>
                <button
                  onClick={handleCancelDnd}
                  disabled={loading}
                  className="w-full px-4 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-400 disabled:opacity-50 transition-colors"
                >
                  取消免打扰
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-textMuted">选择免打扰时长，期间不会收到私信通知</p>
                <div className="grid grid-cols-2 gap-2">
                  {DND_DURATIONS.map((d) => (
                    <button
                      key={d.label}
                      onClick={() => handleSetDnd(d.minutes)}
                      disabled={loading}
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-elevated hover:bg-primary-500/10 hover:text-primary-400 text-textSecondary border border-border rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      <Clock size={12} />
                      {d.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    value={customMinutes}
                    onChange={(e) => setCustomMinutes(e.target.value)}
                    placeholder="自定义分钟数..."
                    min={1}
                    max={10080}
                    disabled={loading}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCustomDnd() }}
                    className="flex-1 bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-textPrimary outline-none focus:border-primary-400 placeholder:text-textMuted disabled:opacity-50"
                  />
                  <button
                    onClick={handleCustomDnd}
                    disabled={loading || !customMinutes.trim()}
                    className="px-3 py-2 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-400 disabled:opacity-50 transition-colors shrink-0"
                  >
                    设置
                  </button>
                </div>
              </div>
            )}
          </div>

          <hr className="border-border" />

          {/* === 导出记录 === */}
          <div>
            <h3 className="text-sm font-medium text-textPrimary flex items-center gap-2 mb-3">
              <Download size={14} className="text-textMuted" />
              导出聊天记录
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-textSecondary">导出格式</label>
                <div className="flex gap-2 mt-1">
                  {[
                    { key: 'json', label: 'JSON' },
                    { key: 'txt', label: '文本' },
                    { key: 'html', label: 'HTML' },
                  ].map(f => (
                    <button
                      key={f.key}
                      onClick={() => setExportFormat(f.key)}
                      className={`flex-1 py-2 rounded-lg border text-center text-xs font-medium transition-colors ${
                        exportFormat === f.key
                          ? 'border-primary-400 bg-primary-500/10 text-primary-300'
                          : 'border-border bg-elevated text-textSecondary hover:bg-canvas'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleExportChat}
                disabled={exporting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-400 disabled:opacity-40 text-sm font-medium transition-all"
              >
                <Download size={16} />
                {exporting ? '导出中...' : '下载导出文件'}
              </button>

              {exportError && <div className="text-xs text-rose-400">{exportError}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
