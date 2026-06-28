import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { useT } from '../i18n/I18nContext'
import { Globe, Check, Loader2, Settings, Server } from 'lucide-react'

interface ModelOption { value: string; label: string }

interface Preset {
  key: string
  label: string
  base_url: string
  chat_model: string
  work_model: string
  embedding_model: string
  thinking_supported: boolean
  models: ModelOption[]
}

interface ProviderConfig {
  provider: string
  base_url: string
  chat_model: string
  work_model: string
  embedding_model: string
  model_options: ModelOption[]
}

export default function ProviderPresetSelector() {
  const t = useT()
  const [presets, setPresets] = useState<Preset[]>([])
  const [current, setCurrent] = useState<ProviderConfig | null>(null)
  const [selectedKey, setSelectedKey] = useState<string>('manual')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // 自定义覆盖（manual 或预设微调时）
  const [overrideBaseUrl, setOverrideBaseUrl] = useState('')
  const [overrideChat, setOverrideChat] = useState('')
  const [overrideWork, setOverrideWork] = useState('')
  const [overrideEmbed, setOverrideEmbed] = useState('')
  const [overrideModels, setOverrideModels] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.get<{ presets: Preset[]; current: ProviderConfig }>('/admin/provider-presets')
      setPresets(data.presets)
      setCurrent(data.current)
      setSelectedKey(data.current.provider || 'manual')
      setOverrideBaseUrl(data.current.base_url || '')
      setOverrideChat(data.current.chat_model || '')
      setOverrideWork(data.current.work_model || '')
      setOverrideEmbed(data.current.embedding_model || '')
      setOverrideModels(data.current.model_options?.length ? JSON.stringify(data.current.model_options, null, 2) : '')
    } catch { /* */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const activePreset = presets.find(p => p.key === selectedKey)

  const handleSelectPreset = (key: string) => {
    setSelectedKey(key)
    setSaved(false)
    if (key === 'manual') return
    const p = presets.find(pr => pr.key === key)
    if (p) {
      setOverrideBaseUrl(p.base_url)
      setOverrideChat(p.chat_model)
      setOverrideWork(p.work_model)
      setOverrideEmbed(p.embedding_model)
      setOverrideModels(JSON.stringify(p.models, null, 2))
    }
  }

  const handleApply = async () => {
    setSaving(true)
    setSaved(false)
    try {
      let modelOptions: ModelOption[] = []
      try { modelOptions = JSON.parse(overrideModels) } catch { /* keep empty */ }

      await api.put('/admin/provider-presets/apply', {
        provider: selectedKey,
        base_url: overrideBaseUrl || undefined,
        chat_model: overrideChat || undefined,
        work_model: overrideWork || undefined,
        embedding_model: overrideEmbed || undefined,
        model_options: modelOptions.length > 0 ? modelOptions : undefined,
      })
      setSaved(true)
      await load()
      setTimeout(() => setSaved(false), 3000)
    } catch { /* */ }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-textMuted" />
      </div>
    )
  }

  return (
    <section className="bg-surface border border-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-textPrimary flex items-center gap-2">
        <Server size={16} className="text-accent-400" />
        {t('admin.llmProvider') || 'LLM 厂商预设'}
      </h3>

      {/* 厂商选择按钮组 */}
      <div className="flex flex-wrap gap-2">
        {presets.map(p => (
          <button
            key={p.key}
            onClick={() => handleSelectPreset(p.key)}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors border ${
              selectedKey === p.key
                ? 'bg-primary-500/15 border-primary-500/40 text-primary-500'
                : 'bg-canvas border-border text-textSecondary hover:text-textPrimary hover:border-primary-500/30'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => handleSelectPreset('manual')}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors border ${
            selectedKey === 'manual'
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-500'
              : 'bg-canvas border-border text-textMuted hover:text-textSecondary'
          }`}
        >
          <Settings size={12} className="inline mr-1" />
          {t('admin.manualConfig') || '手动配置'}
        </button>
      </div>

      {/* 预设详情 + 可覆盖字段 */}
      {activePreset && (
        <div className="text-xs text-textMuted flex items-center gap-1.5">
          <Globe size={12} />
          {activePreset.base_url}
          {activePreset.thinking_supported && (
            <span className="text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded-full">🧠 推理</span>
          )}
        </div>
      )}

      {/* 字段编辑 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-textSecondary mb-1">API Base URL</label>
          <input
            type="text" value={overrideBaseUrl}
            onChange={e => { setOverrideBaseUrl(e.target.value); setSaved(false) }}
            className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-textPrimary text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/60"
            placeholder="https://api.example.com"
          />
        </div>
        <div>
          <label className="block text-xs text-textSecondary mb-1">{t('admin.defaultChatModel') || '默认聊天模型'}</label>
          <input
            type="text" value={overrideChat}
            onChange={e => { setOverrideChat(e.target.value); setSaved(false) }}
            className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-textPrimary text-xs focus:outline-none focus:ring-2 focus:ring-primary-500/60"
          />
        </div>
        <div>
          <label className="block text-xs text-textSecondary mb-1">{t('admin.defaultWorkModel') || '默认工作模型'}</label>
          <input
            type="text" value={overrideWork}
            onChange={e => { setOverrideWork(e.target.value); setSaved(false) }}
            className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-textPrimary text-xs focus:outline-none focus:ring-2 focus:ring-primary-500/60"
          />
        </div>
        <div>
          <label className="block text-xs text-textSecondary mb-1">Embedding 模型</label>
          <input
            type="text" value={overrideEmbed}
            onChange={e => { setOverrideEmbed(e.target.value); setSaved(false) }}
            className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-textPrimary text-xs focus:outline-none focus:ring-2 focus:ring-primary-500/60"
          />
        </div>
      </div>

      {/* 模型列表 JSON */}
      <div>
        <label className="block text-xs text-textSecondary mb-1">{t('admin.modelOptionsJson') || '模型选项列表 (JSON)'}</label>
        <textarea
          rows={4}
          value={overrideModels}
          onChange={e => { setOverrideModels(e.target.value); setSaved(false) }}
          className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-textPrimary text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/60 resize-y"
          placeholder='[{"value":"model-name","label":"显示名称"}]'
        />
      </div>

      {/* 应用按钮 */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleApply}
          disabled={saving || (!overrideBaseUrl && selectedKey === 'manual')}
          className="px-4 py-2 text-sm rounded-lg bg-primary-500 hover:bg-primary-400 disabled:opacity-30 text-white font-medium transition-colors flex items-center gap-1.5"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? t('common.saving') : t('common.apply')}
        </button>
        {saved && (
          <span className="text-xs text-mint-400 animate-pulse">{t('common.saved') || '已保存'}</span>
        )}
      </div>
    </section>
  )
}
