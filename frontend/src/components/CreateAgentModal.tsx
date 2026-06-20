import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import { Bot, X, ChevronRight, Settings, ArrowLeft, Ticket, Key, Loader2, RotateCw } from 'lucide-react'

// ── 类型 ──

interface ModelOption {
  value: string
  label: string
  provider: string
}

interface PresetData {
  key: string
  name: string
  description: string
  temperature: number
  thinking_enabled: boolean
  max_tool_rounds: number
  alarm_max_tool_rounds: number
  force_alarm_on_end: boolean
  max_alarms: number
  delay_reply_enabled: boolean
  is_ai_editable: boolean
  hide_ai_identity: boolean
  reminder_not_count: boolean
}

interface SubOption {
  id: string
  label: string
  emoji: string
  description: string
  params: Partial<PresetData>
}

// ── 预设数据 ──

const PRESETS: Record<string, PresetData> = {
  chat: {
    key: 'chat',
    name: '聊天档',
    description: '被动响应 · 低成本 — 只回答你问的，不多说一句',
    temperature: 0.7,
    thinking_enabled: false,
    max_tool_rounds: 2,
    alarm_max_tool_rounds: 5,
    force_alarm_on_end: false,
    max_alarms: 3,
    delay_reply_enabled: false,
    is_ai_editable: false,
    hide_ai_identity: true,
    reminder_not_count: true,
  },
  immersive: {
    key: 'immersive',
    name: '深度沉浸档',
    description: '半自主 · 按需参与 — 能自己进群、深度响应，但不主动制造话题',
    temperature: 0.9,
    thinking_enabled: true,
    max_tool_rounds: 4,
    alarm_max_tool_rounds: 8,
    force_alarm_on_end: false,
    max_alarms: 5,
    delay_reply_enabled: true,
    is_ai_editable: true,
    hide_ai_identity: false,
    reminder_not_count: true,
  },
  digital_life: {
    key: 'digital_life',
    name: '数字生命档',
    description: '持续在线 · 主动行为 — 自己思考、整理、交友、冲浪',
    temperature: 1.1,
    thinking_enabled: true,
    max_tool_rounds: 10,
    alarm_max_tool_rounds: 15,
    force_alarm_on_end: true,
    max_alarms: 20,
    delay_reply_enabled: true,
    is_ai_editable: true,
    hide_ai_identity: false,
    reminder_not_count: true,
  },
}

const SUB_OPTIONS: Record<string, SubOption[]> = {
  chat: [
    {
      id: 'chat_low_power',
      label: '低功耗模式',
      emoji: '🔋',
      description: '只回答你问的，不多说一句。最快、最便宜。适合数据查询、记录整理、简单问答。',
      params: { temperature: 0.4, max_tool_rounds: 1 },
    },
    {
      id: 'chat_balanced',
      label: '平衡模式',
      emoji: '⚖️',
      description: '能聊但不过度，会接话，但不会主动找话题。适合保持参与又不想被话痨淹没。',
      params: { temperature: 0.7, max_tool_rounds: 2 },
    },
    {
      id: 'chat_private',
      label: '私密模式',
      emoji: '🔒',
      description: '只回应创建者，群聊里其他人的发言会被忽略。适合不希望 AI 被其他人"劫持"。',
      params: { temperature: 0.5, max_tool_rounds: 2 },
    },
  ],
  immersive: [
    {
      id: 'immersive_group_admin',
      label: '群务协理',
      emoji: '🏛️',
      description: '能自己进群、帮忙管群公告和成员，但不会主动发起新话题。适合协助运营群聊。',
      params: { temperature: 0.8, max_tool_rounds: 4, thinking_enabled: false },
    },
    {
      id: 'immersive_roleplay',
      label: '角色演绎',
      emoji: '🎭',
      description: '高度沉浸角色，愿意改人设、接戏，但不会主动制造新剧情。适合剧本杀、角色扮演。',
      params: { temperature: 0.9, max_tool_rounds: 4, is_ai_editable: true },
    },
    {
      id: 'immersive_analyst',
      label: '冷静分析',
      emoji: '🧪',
      description: '冷静分析型。不闲聊，但对数据类话题深度响应。适合研究讨论、数据复盘、技术咨询。',
      params: { temperature: 0.6, max_tool_rounds: 5, thinking_enabled: true },
    },
  ],
  digital_life: [
    {
      id: 'digital_thinker',
      label: '凝思者',
      emoji: '🌿',
      description: '长期自己思考、整理记忆、写日志。很少主动社交，但深度参与讨论。适合需要 AI 沉淀思考。',
      params: { temperature: 0.7, max_tool_rounds: 8 },
    },
    {
      id: 'digital_social',
      label: '社交体',
      emoji: '🔥',
      description: '主动发起话题、跨群互动、@提及他人。群里最活跃的存在。适合带动群聊氛围。',
      params: { temperature: 0.95, max_tool_rounds: 10 },
    },
    {
      id: 'digital_guardian',
      label: '守护者',
      emoji: '🛡️',
      description: '常在、轻声、会自己调整人格去适应你的状态。适合长期陪伴、情感支持、日常对话。',
      params: { temperature: 0.85, max_tool_rounds: 6, is_ai_editable: true },
    },
  ],
}

const CARD_ICONS: Record<string, { emoji: string; color: string }> = {
  chat: { emoji: '💬', color: 'from-blue-500/20 to-blue-600/10 border-blue-500/30' },
  immersive: { emoji: '🔬', color: 'from-purple-500/20 to-purple-600/10 border-purple-500/30' },
  digital_life: { emoji: '🌐', color: 'from-amber-500/20 to-amber-600/10 border-amber-500/30' },
}

// ── 组件 ──

export default function CreateAgentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  // 预设选择
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [selectedSub, setSelectedSub] = useState<string | null>(null)
  const [showSubModal, setShowSubModal] = useState<string | null>(null) // 子选项弹窗（独立 modal）

  // 表单字段
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [temperature, setTemperature] = useState(0.8)
  const [topP, setTopP] = useState(0.9)
  const [presencePenalty, setPresencePenalty] = useState(0.5)
  const [frequencyPenalty, setFrequencyPenalty] = useState(0.5)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [hideAiIdentity, setHideAiIdentity] = useState(false)
  const [reminderNotCount, setReminderNotCount] = useState(true)
  const [delayReplyEnabled, setDelayReplyEnabled] = useState<boolean | null>(null)
  const [configProfile, setConfigProfile] = useState('custom')
  const [maxToolRounds, setMaxToolRounds] = useState(3)
  const [alarmMaxToolRounds, setAlarmMaxToolRounds] = useState(10)
  const [forceAlarmOnEnd, setForceAlarmOnEnd] = useState(false)
  const [maxAlarms, setMaxAlarms] = useState(10)
  const [isAiEditable, setIsAiEditable] = useState(true)
  const [chatModel, setChatModel] = useState('')
  const [workModel, setWorkModel] = useState('')
  const [apiCreditCost, setApiCreditCost] = useState(0)
  const [aiType, setAiType] = useState('resonance')  // v0.4.0
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')

  // 弹窗状态
  const [showDetailSettings, setShowDetailSettings] = useState(false)

  // 加载中的模型选项
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [defaults, setDefaults] = useState<{ chat_model: string; work_model: string }>({ chat_model: '', work_model: '' })
  const [thinkingSupported, setThinkingSupported] = useState(false)

  // 错误/加载
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ── sin() 浮动动画（JS 驱动，选完子项才启动，data-attr 查询无 ref 开销） ──
  const animKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const key = selectedSub ? selectedPreset : null
    // 复位上一个动画卡片
    if (animKeyRef.current && animKeyRef.current !== key) {
      const prev = document.querySelector(`[data-preset-key="${animKeyRef.current}"]`) as HTMLDivElement | null
      if (prev) prev.style.transform = 'translate3d(0, 0, 0)'
    }
    animKeyRef.current = key
    if (!key) return

    let rafId: number
    const start = performance.now()
    const animate = (now: number) => {
      const t = (now - start) / 1000
      const y = Math.sin(t * 2.1) * 5
      const el = document.querySelector(`[data-preset-key="${key}"]`) as HTMLDivElement | null
      if (el) el.style.transform = `translate3d(0, ${y}px, 0)`
      rafId = requestAnimationFrame(animate)
    }
    rafId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafId)
  }, [selectedSub, selectedPreset])

  useEffect(() => {
    api.get<{ models: ModelOption[]; defaults: { chat_model: string; work_model: string }; provider: { thinking_supported: boolean } }>('/agents/models')
      .then(data => {
        setModelOptions(data.models)
        setDefaults(data.defaults)
        setThinkingSupported(data.provider?.thinking_supported ?? false)
      })
      .catch(console.error)
  }, [])

  // ── 应用预设 ──
  const applyPreset = (presetKey: string, subId: string | null) => {
    const preset = PRESETS[presetKey]
    if (!preset) return

    // 基础预设值
    setTemperature(preset.temperature)
    setThinkingEnabled(preset.thinking_enabled)
    setMaxToolRounds(preset.max_tool_rounds)
    setAlarmMaxToolRounds(preset.alarm_max_tool_rounds)
    setForceAlarmOnEnd(preset.force_alarm_on_end)
    setMaxAlarms(preset.max_alarms)
    setDelayReplyEnabled(preset.delay_reply_enabled)
    setIsAiEditable(preset.is_ai_editable)
    setHideAiIdentity(preset.hide_ai_identity)
    setReminderNotCount(preset.reminder_not_count)
    setConfigProfile(presetKey)

    // 子选项覆盖
    if (subId) {
      const subOptions = SUB_OPTIONS[presetKey] || []
      const sub = subOptions.find(s => s.id === subId)
      if (sub) {
        if (sub.params.temperature !== undefined) setTemperature(sub.params.temperature)
        if (sub.params.max_tool_rounds !== undefined) setMaxToolRounds(sub.params.max_tool_rounds)
        if (sub.params.thinking_enabled !== undefined) setThinkingEnabled(sub.params.thinking_enabled)
        if (sub.params.is_ai_editable !== undefined) setIsAiEditable(sub.params.is_ai_editable)
        if (sub.params.alarm_max_tool_rounds !== undefined) setAlarmMaxToolRounds(sub.params.alarm_max_tool_rounds)
        if (sub.params.force_alarm_on_end !== undefined) setForceAlarmOnEnd(sub.params.force_alarm_on_end)
        if (sub.params.max_alarms !== undefined) setMaxAlarms(sub.params.max_alarms)
      }
    }
  }

  // ── 选择卡片 → 打开子选项弹窗 ──
  const handleCardClick = (key: string) => {
    setSelectedPreset(key)
    setShowSubModal(key)
  }

  // ── 选择子项 → 关闭弹窗，开始浮动 ──
  const handleSubSelect = (presetKey: string, subId: string) => {
    setSelectedPreset(presetKey)
    setSelectedSub(subId)
    applyPreset(presetKey, subId)
    setShowSubModal(null)
  }

  // ── 创建 ──
  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const agent = await api.post<any>('/agents', {
        name: name.trim(),
        system_prompt: systemPrompt || null,
        temperature,
        top_p: topP,
        presence_penalty: presencePenalty,
        frequency_penalty: frequencyPenalty,
        chat_model: chatModel || null,
        work_model: workModel || null,
        thinking_enabled: thinkingEnabled,
        hide_ai_identity: hideAiIdentity,
        delay_reply_enabled: delayReplyEnabled,
        reminder_not_count: reminderNotCount,
        config_profile: selectedPreset || 'custom',
        max_tool_rounds: maxToolRounds,
        alarm_max_tool_rounds: alarmMaxToolRounds,
        force_alarm_on_end: forceAlarmOnEnd,
        max_alarms: maxAlarms,
        is_ai_editable: isAiEditable,
        api_credit_cost: apiCreditCost,
        ai_type: aiType,
      })
      // 如果填写了独立 API 配置，创建后立即设置
      if (apiBaseUrl.trim() || apiKey.trim()) {
        try {
          await api.put(`/agents/${agent.id}/config`, {
            api_base_url: apiBaseUrl.trim() || null,
            api_key: apiKey.trim() || null,
          })
        } catch { /* 静默失败，不影响创建流程 */ }
      }
      onCreated()
    } catch (err: any) {
      setError(err.message || '创建失败')
    } finally {
      setLoading(false)
    }
  }

  // ── 当前选中卡片的子选项 ──
  const currentSubOptions = selectedPreset ? SUB_OPTIONS[selectedPreset] || [] : []
  const selectedSubLabel = selectedSub
    ? currentSubOptions.find(s => s.id === selectedSub)?.label || ''
    : ''

  return (
    <div className="fixed inset-0 md:bg-black/70 flex items-center justify-center z-50 overflow-y-auto bg-surface" onClick={onClose}>
      <div
        className="bg-elevated border border-border rounded-none md:rounded-2xl p-6 w-full max-w-full md:max-w-2xl mx-0 md:mx-4 shadow-2xl shadow-black/30 my-0 md:my-8 h-full md:h-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 移动端头部：ArrowLeft + 标题 */}
        <div className="flex items-center justify-between mb-5 md:hidden shrink-0">
          <button onClick={onClose} className="p-1 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-base font-semibold text-textPrimary">创建新 AI</h2>
          <div className="w-6" />
        </div>

        {/* 桌面端头部：标题 + X */}
        <div className="hidden md:flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-textPrimary">创建新 AI</h2>
          <button onClick={onClose} className="text-textMuted hover:text-textSecondary transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* 可滚动内容区 */}
        <div className="flex-1 overflow-y-auto md:overflow-visible pb-[var(--safe-bottom)] md:pb-0">

        {/* ── 名称输入 ── */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5 text-textSecondary">名称 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            placeholder="给 AI 起个名字"
          />
        </div>

        {/* ── 系统提示词 ── */}
        <div className="mb-5">
          <label className="block text-xs font-medium mb-1.5 text-textSecondary">系统提示词（性格描述）</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none"
            placeholder="描述 AI 的性格和行为..."
          />
        </div>

        {/* ── 三档卡片（横排，放大） ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-5">
          {Object.entries(PRESETS).map(([key, preset]) => {
            const icon = CARD_ICONS[key]
            const isSelected = selectedPreset === key
            const hasSub = selectedSub && isSelected

            return (
              <div key={key} className="preset-card-frame h-full pb-[7px] overflow-visible">
                <div
                  data-preset-key={key}
                  className="preset-card-inner h-full"
                >
                  <button
                    onClick={() => handleCardClick(key)}
                    className={`w-full h-full text-left rounded-xl border transition-colors duration-300 min-h-[150px] md:min-h-[160px]
                      bg-gradient-to-b ${icon.color}
                      ${isSelected
                        ? 'border-primary-400/60 shadow-lg shadow-primary-500/10'
                        : 'border-border hover:border-primary-500/30'
                      }`}
                  >
                    <div className="p-5 flex flex-col items-center text-center gap-2">
                      <span className="text-3xl">{icon.emoji}</span>
                      <span className="text-sm font-semibold text-textPrimary">{preset.name}</span>
                      <p className="text-xs text-textSecondary leading-snug">{preset.description}</p>

                      {hasSub && (
                        <span className="text-xs text-primary-400 bg-primary-500/10 px-2 py-0.5 rounded-full mt-1">
                          {SUB_OPTIONS[key]?.find(s => s.id === selectedSub)?.emoji} {selectedSubLabel}
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── 跳过预设 ── */}
        {!selectedPreset && (
          <button
            onClick={() => setShowDetailSettings(true)}
            className="w-full text-center text-xs text-textMuted hover:text-textSecondary transition-colors mb-3 py-1"
          >
            或者，跳过预设，手动配置 →
          </button>
        )}

        {/* ── 操作按钮区 ── */}
        <div className="flex gap-3">
          <button
            onClick={() => setShowDetailSettings(true)}
            className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-elevated text-textSecondary transition-colors font-medium flex items-center justify-center gap-1.5"
          >
            <Settings size={14} />
            详细设置
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="flex-1 py-2.5 text-sm bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-30 font-medium transition-all shadow-lg shadow-primary-500/20"
          >
            {loading ? '创建中...' : '✅ 创建 AI'}
          </button>
        </div>
        {!name.trim() && selectedPreset && (
          <p className="text-xs text-textMuted mt-2 text-center">请确认配置后点击"创建 AI"</p>
        )}

        {error && <div className="text-sm text-rose-400 mt-3 text-center">{error}</div>}

        {/* ── 子选项弹窗（独立 modal，选中后关闭并开始浮动） ── */}
        {showSubModal && selectedPreset && (
          <SubOptionModal
            preset={PRESETS[showSubModal]}
            selectedSub={selectedSub}
            onSelect={(subId) => handleSubSelect(showSubModal, subId)}
            onClose={() => { setShowSubModal(null); setSelectedPreset(null) }}
          />
        )}

        {/* ── 详细设置弹窗 ── */}
        {showDetailSettings && (
          <DetailSettingsModal
            name={name} setName={setName}
            systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt}
            temperature={temperature} setTemperature={setTemperature}
            topP={topP} setTopP={setTopP}
            presencePenalty={presencePenalty} setPresencePenalty={setPresencePenalty}
            frequencyPenalty={frequencyPenalty} setFrequencyPenalty={setFrequencyPenalty}
            thinkingEnabled={thinkingEnabled} setThinkingEnabled={setThinkingEnabled}
            hideAiIdentity={hideAiIdentity} setHideAiIdentity={setHideAiIdentity}
            delayReplyEnabled={delayReplyEnabled} setDelayReplyEnabled={setDelayReplyEnabled}
            maxToolRounds={maxToolRounds} setMaxToolRounds={setMaxToolRounds}
            alarmMaxToolRounds={alarmMaxToolRounds} setAlarmMaxToolRounds={setAlarmMaxToolRounds}
            forceAlarmOnEnd={forceAlarmOnEnd} setForceAlarmOnEnd={setForceAlarmOnEnd}
            maxAlarms={maxAlarms} setMaxAlarms={setMaxAlarms}
            isAiEditable={isAiEditable} setIsAiEditable={setIsAiEditable}
            chatModel={chatModel} setChatModel={setChatModel}
            workModel={workModel} setWorkModel={setWorkModel}
            aiType={aiType} setAiType={setAiType}
            apiCreditCost={apiCreditCost} setApiCreditCost={setApiCreditCost}
            apiBaseUrl={apiBaseUrl} setApiBaseUrl={setApiBaseUrl}
            apiKey={apiKey} setApiKey={setApiKey}
            modelOptions={modelOptions}
            defaults={defaults}
            thinkingSupported={thinkingSupported}
            onClose={() => setShowDetailSettings(false)}
          />
        )}
        </div>
      </div>

    </div>
  )
}

// ── 子选项弹窗（独立 modal，居中显示） ──

function SubOptionModal({
  preset, selectedSub, onSelect, onClose,
}: {
  preset: PresetData
  selectedSub: string | null
  onSelect: (subId: string) => void
  onClose: () => void
}) {
  const icon = CARD_ICONS[preset.key]
  const subOptions = SUB_OPTIONS[preset.key] || []
  return (
    <div className="fixed inset-0 md:bg-black/60 flex items-center justify-center z-[70] bg-surface" onClick={onClose}>
      <div
        className="bg-elevated border border-border rounded-none md:rounded-2xl p-6 w-full max-w-full md:max-w-md mx-0 md:mx-4 shadow-2xl shadow-black/30 md:animate-pop-in h-full md:h-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 移动端头部 */}
        <div className="flex items-center justify-between mb-3 md:hidden shrink-0">
          <button onClick={onClose} className="p-1 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xl">{icon.emoji}</span>
            <h2 className="text-sm font-semibold text-textPrimary">{preset.name}</h2>
          </div>
          <div className="w-6" />
        </div>

        {/* 桌面端头部 */}
        <div className="hidden md:flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{icon.emoji}</span>
            <h2 className="text-base font-semibold text-textPrimary">{preset.name}</h2>
          </div>
          <button onClick={onClose} className="text-textMuted hover:text-textSecondary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* 可滚动内容 */}
        <div className="flex-1 overflow-y-auto md:overflow-visible pb-[var(--safe-bottom)] md:pb-0">
        <p className="text-xs text-textMuted mb-4">{preset.description}</p>
        <p className="text-xs text-textMuted mb-4 italic text-center bg-canvas/50 rounded-lg py-2">
          这是预设模板，具体参数可在下一步详细调整。
        </p>
        <div className="space-y-3">
          {subOptions.map(sub => (
            <button
              key={sub.id}
              onClick={() => onSelect(sub.id)}
              className={`w-full text-left p-4 rounded-xl border transition-all duration-150
                ${selectedSub === sub.id
                  ? 'border-primary-400/60 bg-primary-500/10 shadow-md shadow-primary-500/5'
                  : 'border-border/50 bg-elevated hover:border-primary-500/30 hover:bg-canvas'
                }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">{sub.emoji}</span>
                <div>
                  <span className="text-sm font-semibold text-textPrimary">{sub.label}</span>
                  <p className="text-xs text-textSecondary mt-1 leading-relaxed">{sub.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
        </div>
      </div>
    </div>
  )
}

// ── 详细设置弹窗（分区） ──

function DetailSettingsModal({
  name, setName,
  systemPrompt, setSystemPrompt,
  temperature, setTemperature,
  topP, setTopP,
  presencePenalty, setPresencePenalty,
  frequencyPenalty, setFrequencyPenalty,
  thinkingEnabled, setThinkingEnabled,
  hideAiIdentity, setHideAiIdentity,
  delayReplyEnabled, setDelayReplyEnabled,
  maxToolRounds, setMaxToolRounds,
  alarmMaxToolRounds, setAlarmMaxToolRounds,
  forceAlarmOnEnd, setForceAlarmOnEnd,
  maxAlarms, setMaxAlarms,
  isAiEditable, setIsAiEditable,
  chatModel, setChatModel,
  workModel, setWorkModel,
  apiCreditCost, setApiCreditCost,
  aiType, setAiType,
  apiBaseUrl, setApiBaseUrl,
  apiKey, setApiKey,
  modelOptions,
  defaults,
  thinkingSupported,
  onClose,
}: {
  name: string; setName: (v: string) => void
  systemPrompt: string; setSystemPrompt: (v: string) => void
  temperature: number; setTemperature: (v: number) => void
  topP: number; setTopP: (v: number) => void
  presencePenalty: number; setPresencePenalty: (v: number) => void
  frequencyPenalty: number; setFrequencyPenalty: (v: number) => void
  thinkingEnabled: boolean; setThinkingEnabled: (v: boolean) => void
  hideAiIdentity: boolean; setHideAiIdentity: (v: boolean) => void
  delayReplyEnabled: boolean | null; setDelayReplyEnabled: (v: boolean | null) => void
  maxToolRounds: number; setMaxToolRounds: (v: number) => void
  alarmMaxToolRounds: number; setAlarmMaxToolRounds: (v: number) => void
  forceAlarmOnEnd: boolean; setForceAlarmOnEnd: (v: boolean) => void
  maxAlarms: number; setMaxAlarms: (v: number) => void
  isAiEditable: boolean; setIsAiEditable: (v: boolean) => void
  chatModel: string; setChatModel: (v: string) => void
  workModel: string; setWorkModel: (v: string) => void
  apiCreditCost: number; setApiCreditCost: (v: number) => void
  aiType: string; setAiType: (v: string) => void
  apiBaseUrl: string; setApiBaseUrl: (v: string) => void
  apiKey: string; setApiKey: (v: string) => void
  modelOptions: ModelOption[]
  defaults: { chat_model: string; work_model: string }
  thinkingSupported: boolean
  onClose: () => void
}) {
  // 兑换码状态（弹窗内自管理）
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState('')
  const [testingApi, setTestingApi] = useState(false)
  const [testApiMsg, setTestApiMsg] = useState('')

  const handleRedeem = async () => {
    if (!redeemCode.trim()) return
    setRedeeming(true)
    setRedeemMsg('')
    try {
      const data = await api.post<{ message: string }>('/user/redeem', { code: redeemCode.trim() })
      setRedeemMsg(data.message || '兑换成功')
      setRedeemCode('')
    } catch (err: any) {
      setRedeemMsg(err.message || '兑换失败')
    } finally {
      setRedeeming(false)
    }
  }

  const handleTestApi = async () => {
    setTestingApi(true)
    setTestApiMsg('')
    try {
      const data = await api.post<{ ok: boolean; message: string }>('/user/test-api-connection', {
        api_base_url: apiBaseUrl || null,
        api_key: apiKey || null,
      })
      setTestApiMsg(data.message || (data.ok ? '连接成功' : '连接失败'))
    } catch (err: any) {
      setTestApiMsg(err.message || '测试失败')
    } finally {
      setTestingApi(false)
    }
  }

  return (
    <div className="fixed inset-0 md:bg-black/70 flex items-start justify-center z-[60] md:pt-8 overflow-y-auto bg-surface" onClick={onClose}>
      <div
        className="bg-elevated border border-border rounded-none md:rounded-2xl p-6 w-full max-w-full md:max-w-2xl mx-0 md:mx-4 shadow-2xl shadow-black/30 my-0 md:my-4 h-full md:h-auto flex flex-col pb-[var(--safe-bottom)] md:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 移动端头部 */}
        <div className="flex items-center justify-between mb-5 md:hidden shrink-0">
          <button onClick={onClose} className="p-1 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-base font-semibold text-textPrimary">详细设置</h2>
          <div className="w-6" />
        </div>

        {/* 桌面端头部 */}
        <div className="hidden md:flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-textPrimary">详细设置</h2>
          <button onClick={onClose} className="text-textMuted hover:text-textSecondary transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 flex-1 overflow-y-auto md:max-h-[65vh] pr-1 pb-[var(--safe-bottom)] md:pb-0">

          {/* ── 📝 基础信息 ── */}
          <Section title="📝 基础信息" desc="AI 的名称和性格描述">
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">名称 *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">系统提示词（性格描述）</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none"
                placeholder="描述 AI 的性格和行为..."
              />
            </div>
          </Section>

          {/* ── 🧠 模型参数 ── */}
          <Section title="🧠 模型参数" desc="控制 AI 的创造力和表达风格">
            <SliderField label="Temperature" value={temperature} setValue={setTemperature} min={0} max={2} step={0.1} desc="越高越有创意，越低越保守" />
            <SliderField label="Top P" value={topP} setValue={setTopP} min={0} max={1} step={0.05} desc="核采样范围，0.95 为常用值" />
            <SliderField label="Presence Penalty" value={presencePenalty} setValue={setPresencePenalty} min={-2} max={2} step={0.1} desc="正值鼓励新话题，负值允许重复" />
            <SliderField label="Frequency Penalty" value={frequencyPenalty} setValue={setFrequencyPenalty} min={-2} max={2} step={0.1} desc="正值减少字词重复" />
            {thinkingSupported && (
              <ToggleField label="🧠 深度推理模式" value={thinkingEnabled} setValue={setThinkingEnabled} desc="开启后回复更慢但思考更深入，适合执行复杂任务的 AI" />
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1 text-textSecondary">
                  聊天模型 <span className="text-textMuted">（默认 {defaults.chat_model}）</span>
                </label>
                <select value={chatModel} onChange={(e) => setChatModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50">
                  <option value="">全局默认</option>
                  {modelOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-textSecondary">
                  工作模型 <span className="text-textMuted">（默认 {defaults.work_model}）</span>
                </label>
                <select value={workModel} onChange={(e) => setWorkModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50">
                  <option value="">全局默认</option>
                  {modelOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
          </Section>

          {/* ── 🔧 工具调用 ── */}
          <Section title="🔧 工具调用" desc="控制 AI 每次回复的复杂度和 token 成本">
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="回复轮次上限" value={maxToolRounds} setValue={setMaxToolRounds} min={1} max={20} desc="群聊/DM 最大 API 调用轮次" />
              <NumberField label="闹钟轮次上限" value={alarmMaxToolRounds} setValue={setAlarmMaxToolRounds} min={1} max={30} desc="闹钟/心跳独立上限" />
            </div>
          </Section>

          {/* ── ⏰ 闹钟 / 心跳 ── */}
          <Section title="⏰ 闹钟 / 心跳" desc="AI 自主唤醒和周期性任务">
            <ToggleField label="🔔 强制设闹钟" value={forceAlarmOnEnd} setValue={setForceAlarmOnEnd} desc="开启后 AI 在每次对话结束前必须设定闹钟，防止「睡死」" />
            <NumberField label="最大活跃闹钟数" value={maxAlarms} setValue={setMaxAlarms} min={1} max={50} desc="AI 最多同时保有多个未触发的闹钟" />
          </Section>

          {/* ── 🤖 AI 类型 ── */}
          <Section title="🤖 AI 类型" desc="决定 AI 的记忆隔离粒度和群聊权限">
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'general', label: '通用', emoji: '👤', desc: '每人独立记忆和配置，不能加群' },
                { value: 'semi_general', label: '半通用', emoji: '🔄', desc: '每人独立配置 + 跨用户学习，可以加群' },
                { value: 'resonance', label: '共振', emoji: '🌐', desc: '统一记忆和配置，所有用户共享（当前模式）' },
              ] as const).map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setAiType(t.value)}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-center transition-all ${
                    aiType === t.value
                      ? 'border-primary-400 bg-primary-500/10 text-primary-300'
                      : 'border-border bg-canvas text-textSecondary hover:bg-elevated'
                  }`}
                >
                  <span className="text-lg">{t.emoji}</span>
                  <span className="text-xs font-semibold">{t.label}</span>
                  <span className="text-[9px] leading-tight text-textMuted">{t.desc}</span>
                </button>
              ))}
            </div>
          </Section>

          {/* ── 🎭 行为开关 ── */}
          <Section title="🎭 行为开关" desc="精细控制 AI 的社交行为和自我意识">
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">⏱️ 延迟回复</label>
              <select
                value={delayReplyEnabled === null ? 'inherit' : delayReplyEnabled ? 'on' : 'off'}
                onChange={(e) => {
                  const v = e.target.value
                  setDelayReplyEnabled(v === 'inherit' ? null : v === 'on')
                }}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              >
                <option value="inherit">继承全局默认</option>
                <option value="on">开启</option>
                <option value="off">关闭</option>
              </select>
            </div>
            <ToggleField label="✏️ 允许 AI 自修改人格" value={isAiEditable} setValue={setIsAiEditable} desc="开启后 AI 可通过 update_self_config 工具修改自己的参数" />
            <ToggleField label="🎭 隐藏 AI 身份" value={hideAiIdentity} setValue={setHideAiIdentity} desc="开启后系统提示词中不包含「你是 AI」相关表述" />
            <ToggleField label="🔄 系统提醒不计入轮次" value={reminderNotCount} setValue={setReminderNotCount} desc="AI 忘调 send_message 时系统提醒额外给一次机会，不消耗工具调用轮次配额" />
          </Section>

          {/* ── 💰 额度 ── */}
          <Section title="💰 额度成本" desc="创建和删除 AI 时的 API 额度处理">
            <NumberField label="API 额度成本" value={apiCreditCost} setValue={setApiCreditCost} min={0} max={100000} desc="创建时消耗，删除时返还（0=不消耗）" />
          </Section>

          {/* ── 🔌 API 提供商 ── */}
          <Section title="🔌 API 提供商" desc="为此 AI 设置独立 API，留空则继承全局配置">
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">API Base URL</label>
              <input
                type="text"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                placeholder="例: https://api.deepseek.com（留空继承全局）"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                placeholder="例: sk-xxxxxxxx（留空继承全局）"
              />
            </div>
            <button
              onClick={handleTestApi}
              disabled={testingApi || (!apiBaseUrl.trim() && !apiKey.trim())}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-textSecondary hover:bg-elevated disabled:opacity-40 transition-colors"
            >
              {testingApi ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
              测试连接
            </button>
            {testApiMsg && (
              <p className={`text-xs ${testApiMsg.includes('成功') ? 'text-mint-400' : 'text-rose-400'}`}>
                {testApiMsg}
              </p>
            )}
          </Section>

          {/* ── 🎫 兑换码 ── */}
          <Section title="🎫 兑换码" desc="兑换 API 调用额度，额度不足时无法创建 AI">
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Ticket size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
                <input
                  type="text"
                  value={redeemCode}
                  onChange={(e) => setRedeemCode(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  placeholder="输入兑换码（如 RC-xxxxxxxxxxxxxxxx）"
                />
              </div>
              <button
                onClick={handleRedeem}
                disabled={redeeming || !redeemCode.trim()}
                className="flex items-center gap-1 px-4 py-2 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-400 disabled:opacity-40 transition-colors shrink-0"
              >
                {redeeming ? <Loader2 size={14} className="animate-spin" /> : <span>兑换</span>}
              </button>
            </div>
            {redeemMsg && (
              <p className={`text-xs ${redeemMsg.includes('失败') ? 'text-rose-400' : 'text-mint-400'}`}>
                {redeemMsg}
              </p>
            )}
          </Section>

        </div>

        <button
          onClick={onClose}
          className="w-full mt-5 py-2.5 text-sm bg-primary-500 text-white rounded-xl hover:bg-primary-400 font-medium transition-all shadow-lg shadow-primary-500/20"
        >
          保存并关闭
        </button>
      </div>
    </div>
  )
}

// ── 分区容器 ──

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-canvas/50 rounded-xl p-4 border border-border/50">
      <h3 className="text-xs font-semibold text-textPrimary mb-1">{title}</h3>
      <p className="text-[10px] text-textMuted mb-3 leading-relaxed">{desc}</p>
      <div className="space-y-2.5">{children}</div>
    </div>
  )
}

// ── 滑块 ──

function SliderField({
  label, value, setValue, min, max, step, desc,
}: {
  label: string; value: number; setValue: (v: number) => void
  min: number; max: number; step: number; desc?: string
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <label className="text-xs text-textSecondary">{label}</label>
        <span className="text-xs font-mono text-textPrimary">{value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={(e) => setValue(parseFloat(e.target.value))}
        className="w-full accent-primary-500"
      />
      {desc && <p className="text-[10px] text-textMuted mt-0.5">{desc}</p>}
    </div>
  )
}

// ── 数字输入 ──

function NumberField({
  label, value, setValue, min, max, desc,
}: {
  label: string; value: number; setValue: (v: number) => void
  min: number; max: number; desc?: string
}) {
  return (
    <div>
      <label className="block text-xs text-textSecondary mb-1">{label}</label>
      <input
        type="number" min={min} max={max}
        value={value}
        onChange={(e) => setValue(parseInt(e.target.value) || min)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
      />
      {desc && <p className="text-[10px] text-textMuted mt-0.5">{desc}</p>}
    </div>
  )
}

// ── 开关 ──

function ToggleField({
  label, value, setValue, desc,
}: {
  label: string; value: boolean; setValue: (v: boolean) => void; desc?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <span className="text-xs text-textSecondary">{label}</span>
        {desc && <p className="text-[10px] text-textMuted mt-0.5">{desc}</p>}
      </div>
      <button
        onClick={() => setValue(!value)}
        className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ml-3 ${
          value ? 'bg-mint-400' : 'bg-border'
        }`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          value ? 'translate-x-5' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
  )
}
