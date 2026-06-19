import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { Bot, X, ChevronRight, Settings } from 'lucide-react'

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
      description: '主动加好友、跨群引用、发起话题。群里最活跃的存在。适合带动群聊氛围。',
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
  const [showSubPopup, setShowSubPopup] = useState<string | null>(null) // 哪个卡片展开了子选项

  // 表单字段
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [temperature, setTemperature] = useState(0.8)
  const [topP, setTopP] = useState(0.9)
  const [presencePenalty, setPresencePenalty] = useState(0.5)
  const [frequencyPenalty, setFrequencyPenalty] = useState(0.5)
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
  const [hideAiIdentity, setHideAiIdentity] = useState(false)
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

  // 弹窗状态
  const [showDetailSettings, setShowDetailSettings] = useState(false)

  // 加载中的模型选项
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [defaults, setDefaults] = useState<{ chat_model: string; work_model: string }>({ chat_model: '', work_model: '' })
  const [thinkingSupported, setThinkingSupported] = useState(false)

  // 错误/加载
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

  // ── 选择卡片 ──
  const handleCardClick = (key: string) => {
    if (showSubPopup === key) {
      setShowSubPopup(null)
      return
    }
    setShowSubPopup(key)
    setSelectedPreset(key)
  }

  // ── 选择子项 ──
  const handleSubSelect = (presetKey: string, subId: string) => {
    setSelectedPreset(presetKey)
    setSelectedSub(subId)
    applyPreset(presetKey, subId)
    setShowSubPopup(null)
  }

  // ── 创建 ──
  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post('/agents', {
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
        config_profile: selectedPreset || 'custom',
        max_tool_rounds: maxToolRounds,
        alarm_max_tool_rounds: alarmMaxToolRounds,
        force_alarm_on_end: forceAlarmOnEnd,
        max_alarms: maxAlarms,
        is_ai_editable: isAiEditable,
        api_credit_cost: apiCreditCost,
      })
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl shadow-black/30 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-textPrimary">创建新 AI</h2>
          <button onClick={onClose} className="text-textMuted hover:text-textSecondary transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* ── 名称输入 ── */}
        <div className="mb-5">
          <label className="block text-xs font-medium mb-1.5 text-textSecondary">名称 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            placeholder="给 AI 起个名字"
          />
        </div>

        {/* ── 三档卡片 ── */}
        <div className="space-y-3 mb-5">
          {Object.entries(PRESETS).map(([key, preset], idx) => {
            const icon = CARD_ICONS[key]
            const isSelected = selectedPreset === key
            const subOptions = SUB_OPTIONS[key] || []

            return (
              <div key={key}>
                <button
                  onClick={() => handleCardClick(key)}
                  className={`w-full text-left relative overflow-hidden rounded-xl border transition-all duration-300 group
                    ${isSelected
                      ? 'border-primary-400/60 shadow-lg shadow-primary-500/10 selected-card'
                      : 'border-border hover:border-primary-500/30 hover:shadow-md'
                    }
                    bg-gradient-to-r ${icon.color}
                  `}
                  style={{
                    animation: `float-card-${idx + 1} ${3.5 + idx * 0.7}s ease-in-out infinite`,
                  }}
                >
                  <div className="px-4 py-3.5 flex items-start gap-3">
                    <span className="text-2xl flex-shrink-0 mt-0.5">{icon.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-textPrimary">{preset.name}</span>
                        <span className="text-[10px] text-textMuted bg-canvas/60 px-1.5 py-0.5 rounded">预设</span>
                      </div>
                      <p className="text-xs text-textSecondary leading-relaxed">{preset.description}</p>

                      {/* 已选子项标签 */}
                      {isSelected && selectedSub && (
                        <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-primary-400 bg-primary-500/10 px-2 py-0.5 rounded-full">
                          {SUB_OPTIONS[key]?.find(s => s.id === selectedSub)?.emoji} {selectedSubLabel}
                        </div>
                      )}
                    </div>
                    <ChevronRight
                      size={16}
                      className={`flex-shrink-0 mt-1.5 text-textMuted transition-transform duration-300 ${showSubPopup === key ? 'rotate-90' : ''}`}
                    />
                  </div>
                </button>

                {/* ── 子选项悬浮窗 ── */}
                {showSubPopup === key && (
                  <div className="mt-2 mx-2 bg-canvas border border-border rounded-xl p-4 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
                    <p className="text-xs text-textMuted mb-3 italic">
                      "这是预设模板，具体参数可在下一步详细调整。"
                    </p>
                    <div className="space-y-2">
                      {subOptions.map(sub => (
                        <button
                          key={sub.id}
                          onClick={() => handleSubSelect(key, sub.id)}
                          className={`w-full text-left p-3 rounded-lg border transition-all duration-200
                            ${selectedSub === sub.id
                              ? 'border-primary-400/40 bg-primary-500/5'
                              : 'border-transparent bg-elevated hover:bg-canvas hover:border-border'
                            }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="text-lg flex-shrink-0">{sub.emoji}</span>
                            <div>
                              <span className="text-xs font-semibold text-textPrimary">{sub.label}</span>
                              <p className="text-[11px] text-textSecondary mt-0.5 leading-relaxed">{sub.description}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

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
            apiCreditCost={apiCreditCost} setApiCreditCost={setApiCreditCost}
            modelOptions={modelOptions}
            defaults={defaults}
            thinkingSupported={thinkingSupported}
            onClose={() => setShowDetailSettings(false)}
          />
        )}
      </div>

      {/* ── CSS 动画 ── */}
      <style>{`
        @keyframes float-card-1 {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        @keyframes float-card-2 {
          0%, 100% { transform: translateY(-2px); }
          50% { transform: translateY(3px); }
        }
        @keyframes float-card-3 {
          0%, 100% { transform: translateY(2px); }
          50% { transform: translateY(-5px); }
        }
        @keyframes border-breathe {
          0%, 100% { border-color: rgba(139, 92, 246, 0.3); box-shadow: 0 0 8px rgba(139, 92, 246, 0.15); }
          50% { border-color: rgba(139, 92, 246, 0.5); box-shadow: 0 0 14px rgba(139, 92, 246, 0.25); }
        }
        .selected-card {
          animation: border-breathe 3s ease-in-out infinite !important;
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slide-in-from-top-2 {
          from { transform: translateY(-8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-in {
          animation: fade-in 0.2s ease-out, slide-in-from-top-2 0.2s ease-out;
        }
      `}</style>
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
  modelOptions: ModelOption[]
  defaults: { chat_model: string; work_model: string }
  thinkingSupported: boolean
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center z-[60] pt-8 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl shadow-black/30 my-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-textPrimary">详细设置</h2>
          <button onClick={onClose} className="text-textMuted hover:text-textSecondary transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-1">

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
            <ToggleField label="🔔 强制设闹钟" value={forceAlarmOnEnd} setValue={setForceAlarmOnEnd} desc="开启后 AI 在每次对话结束前必须设定闹钟，防止"睡死"" />
            <NumberField label="最大活跃闹钟数" value={maxAlarms} setValue={setMaxAlarms} min={1} max={50} desc="AI 最多同时保有多个未触发的闹钟" />
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
            <ToggleField label="🎭 隐藏 AI 身份" value={hideAiIdentity} setValue={setHideAiIdentity} desc="开启后系统提示词中不包含"你是 AI"相关表述" />
          </Section>

          {/* ── 💰 额度 ── */}
          <Section title="💰 额度成本" desc="创建和删除 AI 时的 API 额度处理">
            <NumberField label="API 额度成本" value={apiCreditCost} setValue={setApiCreditCost} min={0} max={100000} desc="创建时消耗，删除时返还（0=不消耗）" />
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
          value ? 'bg-mint-400' : 'bg-[#3a3a4a]'
        }`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          value ? 'translate-x-5' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
  )
}
