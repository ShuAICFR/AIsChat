import { useState, useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { Bot, Plus, Edit3, History, Power, Download, Upload, X, RotateCcw, Eye, EyeOff, Menu } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import CreateAgentModal from '../components/CreateAgentModal'

interface ModelOption {
  value: string
  label: string
  provider: string
}

interface Agent {
  id: number
  name: string
  state: string
  is_ai_editable: boolean
  original_system_prompt: string | null
  original_temperature: number
  original_top_p: number
  original_presence_penalty: number
  original_frequency_penalty: number
  current_system_prompt: string | null
  current_temperature: number
  current_top_p: number
  current_presence_penalty: number
  current_frequency_penalty: number
  chat_model: string | null
  work_model: string | null
  thinking_enabled: boolean
  hide_ai_identity: boolean
  config_profile: string
  delay_reply_enabled: boolean | null
  max_tool_rounds: number
  alarm_max_tool_rounds: number
  force_alarm_on_end: boolean
  max_alarms: number
  api_credit_cost: number
  api_base_url: string | null
  has_api_key: boolean
  avatar_url: string | null
  created_at: string
}

interface ConfigHistory {
  id: number
  agent_id: number
  system_prompt: string | null
  temperature: number
  top_p: number
  presence_penalty: number
  frequency_penalty: number
  created_at: string | null
}

const stateLabels: Record<string, string> = {
  active: '在线',
  dnd: '勿扰',
  offline: '离线',
  blocked: '封禁',
}

const PRESET_LABELS: Record<string, string> = {
  chat: '聊天档', immersive: '深度沉浸档', digital_life: '数字生命档',
}

const PARAM_LABELS: Record<string, string> = {
  temperature: 'Temperature', top_p: 'Top P',
  presence_penalty: 'Presence', frequency_penalty: 'Frequency',
  thinking_enabled: '深度推理', max_tool_rounds: '回复轮次上限',
  alarm_max_tool_rounds: '闹钟轮次上限', force_alarm_on_end: '强制设闹钟',
  max_alarms: '最大闹钟数', is_ai_editable: '自修改人格',
  hide_ai_identity: '隐藏AI身份', delay_reply_enabled: '延迟回复',
}

const stateColors: Record<string, string> = {
  active: 'bg-mint-400/15 text-mint-400 border-mint-400/30',
  dnd: 'bg-rose-400/15 text-rose-400 border-rose-400/30',
  offline: 'bg-[#6B7280]/15 text-textSecondary border-[#6B7280]/30',
  blocked: 'bg-accent-400/15 text-accent-400 border-accent-400/30',
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editAgent, setEditAgent] = useState<Agent | null>(null)
  const [historyAgent, setHistoryAgent] = useState<Agent | null>(null)
  const [stateAgent, setStateAgent] = useState<Agent | null>(null)
  const { refreshUser } = useAuth()
  const { openDrawer } = useOutletContext<{ openDrawer: () => void }>()

  const loadAgents = async () => {
    try {
      const data = await api.get('/agents')
      setAgents(data)
    } catch (err) {
      console.error('加载 AI 列表失败:', err)
    }
  }

  useEffect(() => {
    loadAgents()
  }, [])

  const handleExport = async (agent: Agent) => {
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`/api/agents/${agent.id}/export`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '导出失败')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `soul_${agent.name}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      console.error('导出失败:', err)
      alert(err.message || '导出失败')
    }
  }

  const navigate = useNavigate()

  return (
    <div className="h-full flex flex-col bg-canvas">
      {/* 头部 */}
      <div className="px-4 h-14 border-b border-border bg-surface flex items-center gap-2 shrink-0">
        <button
          onClick={openDrawer}
          className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
          title="菜单"
        >
          <Menu size={18} />
        </button>
        <h1 className="font-semibold text-textPrimary text-sm">我的 AI</h1>
        <span className="text-xs text-textMuted hidden sm:inline">创建和管理你的 AI 角色</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3 py-1.5 md:py-2 border border-border text-textSecondary rounded-lg hover:bg-elevated text-xs font-medium transition-colors"
          >
            <Upload size={13} className="md:w-3.5 md:h-3.5" />
            <span className="hidden sm:inline">导入灵魂</span>
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 md:py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-400 text-xs font-medium transition-all shadow-lg shadow-primary-500/20"
          >
            <Plus size={13} />
            <span className="hidden sm:inline">创建 AI</span>
          </button>
        </div>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto">

        {/* AI 卡片列表 */}
        {agents.length === 0 ? (
          <div className="text-center py-16">
            <Bot size={48} className="mx-auto text-textMuted mb-4" />
            <p className="text-textSecondary">还没有 AI 角色</p>
            <p className="text-sm text-textMuted mt-1">点击"创建 AI"开始</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => {
              const hasModified =
                agent.current_system_prompt !== agent.original_system_prompt ||
                agent.current_temperature !== agent.original_temperature

              return (
                <div
                  key={agent.id}
                  onClick={() => navigate(`/agents/${agent.id}`)}
                  className="bg-surface border border-border rounded-xl p-5 hover:border-primary-500/30 transition-all duration-200 cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary-500/15 flex items-center justify-center">
                        <Bot size={20} className="text-primary-400" />
                      </div>
                      <div>
                        <h3 className="font-medium text-textPrimary">{agent.name}</h3>
                        <p className="text-xs text-textMuted">
                          {new Date(agent.created_at).toLocaleDateString('zh-CN')}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${stateColors[agent.state] || ''}`}>
                      {stateLabels[agent.state] || agent.state}
                    </span>
                  </div>

                  {agent.current_system_prompt && (
                    <p className="text-sm text-textSecondary line-clamp-2 mb-3">
                      {agent.current_system_prompt}
                    </p>
                  )}

                  <div className="flex items-center gap-2 text-xs text-textMuted mb-1 flex-wrap">
                    <span className="text-textSecondary font-medium">
                      {agent.chat_model || '默认'}
                    </span>
                    <span>
                      Temp: {agent.current_temperature}
                      {hasModified && agent.original_temperature !== agent.current_temperature && (
                        <span className="text-accent-400 ml-0.5">({agent.original_temperature})</span>
                      )}
                    </span>
                    {agent.is_ai_editable && (
                      <span className="text-mint-400">可自修改</span>
                    )}
                    {agent.thinking_enabled && (
                      <span className="text-accent-400">🧠 深度推理</span>
                    )}
                    {hasModified && (
                      <span className="text-accent-400 font-medium">已修改</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                    <button
                      onClick={() => setEditAgent(agent)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-textSecondary hover:text-primary-400 rounded-lg hover:bg-elevated transition-colors"
                    >
                      <Edit3 size={12} /> 编辑
                    </button>
                    <button
                      onClick={() => setHistoryAgent(agent)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-textSecondary hover:text-primary-400 rounded-lg hover:bg-elevated transition-colors"
                    >
                      <History size={12} /> 历史
                    </button>
                    <button
                      onClick={() => setStateAgent(agent)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-textSecondary hover:text-accent-400 rounded-lg hover:bg-elevated transition-colors"
                    >
                      <Power size={12} /> 状态
                    </button>
                    <button
                      onClick={() => handleExport(agent)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-textSecondary hover:text-mint-400 rounded-lg hover:bg-elevated transition-colors"
                    >
                      <Download size={12} /> 导出
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 创建弹窗 */}
        {showCreate && (
          <CreateAgentModal
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false)
              loadAgents()
              refreshUser()
            }}
          />
        )}

        {/* 编辑弹窗 */}
        {editAgent && (
          <EditAgentModal
            agent={editAgent}
            onClose={() => setEditAgent(null)}
            onUpdated={() => {
              setEditAgent(null)
              loadAgents()
            }}
          />
        )}

        {/* 历史弹窗 */}
        {historyAgent && (
          <HistoryModal
            agent={historyAgent}
            onClose={() => setHistoryAgent(null)}
            onRollback={() => {
              setHistoryAgent(null)
              loadAgents()
            }}
          />
        )}

        {/* 状态弹窗 */}
        {stateAgent && (
          <StateModal
            agent={stateAgent}
            onClose={() => setStateAgent(null)}
            onUpdated={() => {
              setStateAgent(null)
              loadAgents()
            }}
          />
        )}

        {/* 导入灵魂弹窗 */}
        {showImport && (
          <ImportSoulModal
            onClose={() => setShowImport(false)}
            onImported={() => {
              setShowImport(false)
              loadAgents()
              refreshUser()
            }}
          />
        )}
        </div>
      </div>
    </div>
  )
}

/* ================================================================
   编辑 AI 配置弹窗
   左侧：原始设定（只读） | 右侧：当前设定（可编辑）
   ================================================================ */
function EditAgentModal({ agent, onClose, onUpdated }: {
  agent: Agent; onClose: () => void; onUpdated: () => void
}) {
  const [systemPrompt, setSystemPrompt] = useState(agent.current_system_prompt || '')
  const [temperature, setTemperature] = useState(agent.current_temperature)
  const [topP, setTopP] = useState(agent.current_top_p)
  const [presencePenalty, setPresencePenalty] = useState(agent.current_presence_penalty)
  const [frequencyPenalty, setFrequencyPenalty] = useState(agent.current_frequency_penalty)
  const [chatModel, setChatModel] = useState(agent.chat_model || '')
  const [workModel, setWorkModel] = useState(agent.work_model || '')
  const [thinkingEnabled, setThinkingEnabled] = useState(agent.thinking_enabled)
  const [hideAiIdentity, setHideAiIdentity] = useState(agent.hide_ai_identity || false)
  const [delayReplyEnabled, setDelayReplyEnabled] = useState<boolean | null>(agent.delay_reply_enabled ?? null)
  const [configProfile, setConfigProfile] = useState(agent.config_profile || 'custom')
  const [maxToolRounds, setMaxToolRounds] = useState(agent.max_tool_rounds ?? 3)
  const [alarmMaxToolRounds, setAlarmMaxToolRounds] = useState(agent.alarm_max_tool_rounds ?? 10)
  const [forceAlarmOnEnd, setForceAlarmOnEnd] = useState(agent.force_alarm_on_end ?? false)
  const [maxAlarms, setMaxAlarms] = useState(agent.max_alarms ?? 10)
  const [isAiEditable, setIsAiEditable] = useState(agent.is_ai_editable ?? true)
  const [agentApiBaseUrl, setAgentApiBaseUrl] = useState(agent.api_base_url || '')
  const [agentApiKey, setAgentApiKey] = useState('')
  const [applyingPreset, setApplyingPreset] = useState(false)
  const [presetPreview, setPresetPreview] = useState<any>(null) // 预设预览数据
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [defaults, setDefaults] = useState<{ chat_model: string; work_model: string }>({ chat_model: '', work_model: '' })
  const [thinkingSupported, setThinkingSupported] = useState(false)

  useEffect(() => {
    api.get<{ models: ModelOption[]; defaults: { chat_model: string; work_model: string }; provider: { thinking_supported: boolean } }>('/agents/models')
      .then(data => {
        setModelOptions(data.models)
        setDefaults(data.defaults)
        setThinkingSupported(data.provider?.thinking_supported ?? false)
      })
      .catch(console.error)
  }, [])

  const hasModified =
    agent.current_system_prompt !== agent.original_system_prompt ||
    agent.current_temperature !== agent.original_temperature

  const effectiveChatModel = chatModel || defaults.chat_model
  const effectiveWorkModel = workModel || defaults.work_model

  const handleSave = async () => {
    setLoading(true)
    setError('')
    try {
      const hideIdentity = hideAiIdentity
      const apiBaseUrl = agentApiBaseUrl || null
      const apiKey = agentApiKey || null

      await api.put(`/agents/${agent.id}/config`, {
        system_prompt: systemPrompt || null,
        temperature,
        top_p: topP,
        presence_penalty: presencePenalty,
        frequency_penalty: frequencyPenalty,
        chat_model: chatModel || null,
        work_model: workModel || null,
        thinking_enabled: thinkingEnabled,
        hide_ai_identity: hideIdentity,
        delay_reply_enabled: delayReplyEnabled,
        max_tool_rounds: maxToolRounds,
        alarm_max_tool_rounds: alarmMaxToolRounds,
        force_alarm_on_end: forceAlarmOnEnd,
        max_alarms: maxAlarms,
        is_ai_editable: isAiEditable,
        api_base_url: apiBaseUrl,
        api_key: apiKey,
      })
      onUpdated()
    } catch (err: any) {
      setError(err.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  const handleApplyPreset = async (profile: string) => {
    // 先预览
    setApplyingPreset(true)
    setError('')
    try {
      const preview = await api.get<any>(`/agents/${agent.id}/preset-preview?profile=${profile}`)
      setPresetPreview({ profile, ...preview })
    } catch (err: any) {
      setError(err.message || '预览失败')
      setApplyingPreset(false)
    }
  }

  const confirmApplyPreset = async () => {
    if (!presetPreview) return
    const profile = presetPreview.profile
    setApplyingPreset(true)
    setError('')
    try {
      const updated = await api.post<Agent>(`/agents/${agent.id}/apply-preset`, { profile })
      setTemperature(updated.current_temperature)
      setTopP(updated.current_top_p)
      setPresencePenalty(updated.current_presence_penalty)
      setFrequencyPenalty(updated.current_frequency_penalty)
      setThinkingEnabled(updated.thinking_enabled)
      setMaxToolRounds(updated.max_tool_rounds)
      setAlarmMaxToolRounds(updated.alarm_max_tool_rounds)
      setForceAlarmOnEnd(updated.force_alarm_on_end)
      setMaxAlarms(updated.max_alarms)
      setIsAiEditable(updated.is_ai_editable)
      setConfigProfile(profile)
      setPresetPreview(null)
      onUpdated()
    } catch (err: any) {
      setError(err.message || '应用预设失败')
    } finally {
      setApplyingPreset(false)
    }
  }

  const presets = [
    { key: 'chat', label: '聊天档', desc: '被动响应·低成本' },
    { key: 'immersive', label: '深度沉浸档', desc: '半自主·按需参与' },
    { key: 'digital_life', label: '数字生命档', desc: '持续在线·主动行为' },
  ]

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto shadow-2xl shadow-black/30 pb-[var(--safe-bottom)] md:pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-textPrimary">编辑 {agent.name}</h2>
          <button onClick={onClose} className="p-1 hover:bg-elevated rounded-lg text-textMuted hover:text-textSecondary">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* 原始设定（只读） */}
          <div className="bg-canvas rounded-xl p-4 border border-border">
            <h3 className="text-sm font-semibold text-textSecondary mb-3 flex items-center gap-1">
              📋 原始设定（你的初始配置）
            </h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-xs text-textMuted">System Prompt:</span>
                <p className="text-textSecondary mt-0.5 whitespace-pre-wrap line-clamp-6">
                  {agent.original_system_prompt || '（未设置）'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <span className="text-textMuted">聊天模型:</span>
                <span className="text-textSecondary">{agent.chat_model || `默认 (${defaults.chat_model})`}</span>
                <span className="text-textMuted">工作模型:</span>
                <span className="text-textSecondary">{agent.work_model || `默认 (${defaults.work_model})`}</span>
                <span className="text-textMuted">Temperature:</span>
                <span className="text-textSecondary">{agent.original_temperature}</span>
                <span className="text-textMuted">Top P:</span>
                <span className="text-textSecondary">{agent.original_top_p}</span>
                <span className="text-textMuted">Presence:</span>
                <span className="text-textSecondary">{agent.original_presence_penalty}</span>
                <span className="text-textMuted">Frequency:</span>
                <span className="text-textSecondary">{agent.original_frequency_penalty}</span>
              </div>
            </div>
          </div>

          {/* 当前设定（可编辑） */}
          <div className="bg-primary-500/5 rounded-xl p-4 border border-primary-500/20">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-primary-400 flex items-center gap-1">
                当前设定{hasModified ? '（AI 已修改）' : ''}
              </h3>
              {/* 档位标签 */}
              {configProfile !== 'custom' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-400 font-medium">
                  {configProfile === 'chat' ? '聊天档' : configProfile === 'immersive' ? '沉浸档' : '生命档'}
                </span>
              )}
            </div>
            {/* 三档快捷切换 */}
            <div className="flex gap-1.5 mb-3">
              {presets.map(p => (
                <button
                  key={p.key}
                  onClick={() => handleApplyPreset(p.key)}
                  disabled={applyingPreset || configProfile === p.key}
                  className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-all ${
                    configProfile === p.key
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'bg-canvas border border-border text-textSecondary hover:border-primary-500/40 hover:text-primary-400'
                  } disabled:opacity-50`}
                  title={p.desc}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-textMuted">System Prompt</label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-1.5 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none mt-0.5"
                />
              </div>
              {/* 模型选择 */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-textMuted">聊天模型</label>
                  <select
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value)}
                    className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-border bg-canvas text-xs text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  >
                    <option value="">默认 ({defaults.chat_model})</option>
                    {modelOptions.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-textMuted">工作模型</label>
                  <select
                    value={workModel}
                    onChange={(e) => setWorkModel(e.target.value)}
                    className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-border bg-canvas text-xs text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  >
                    <option value="">默认 ({defaults.work_model})</option>
                    {modelOptions.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="text-[10px] text-textMuted">
                生效：聊天 {effectiveChatModel} · 工作 {effectiveWorkModel}
              </div>
              <div className="space-y-1.5 text-xs">
                {[
                  ['Temperature', temperature, setTemperature, 0, 2, 0.1],
                  ['Top P', topP, setTopP, 0, 1, 0.05],
                  ['Presence', presencePenalty, setPresencePenalty, -2, 2, 0.1],
                  ['Frequency', frequencyPenalty, setFrequencyPenalty, -2, 2, 0.1],
                ].map(([label, value, setter, min, max, step]) => (
                  <div key={label as string}>
                    <label className="text-textMuted">{label as string}: {String(value)}</label>
                    <input
                      type="range"
                      min={min as number}
                      max={max as number}
                      step={step as number}
                      value={value as number}
                      onChange={(e) => (setter as any)(parseFloat(e.target.value))}
                      className="w-full h-1 accent-primary-500"
                    />
                  </div>
                ))}
              </div>
              {/* 深度推理模式（仅 DeepSeek API 显示） */}
              {thinkingSupported && (
                <div className="flex items-center justify-between pt-2 border-t border-border mt-2">
                  <div>
                    <span className="text-xs text-textSecondary">🧠 深度推理模式</span>
                    <p className="text-[10px] text-textMuted mt-0.5">开启后回复更慢但思考更深入</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={thinkingEnabled}
                      onChange={(e) => setThinkingEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-600 rounded-full peer peer-checked:bg-primary-500 peer-focus:ring-2 peer-focus:ring-primary-500/30 after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                  </label>
                </div>
              )}
              {/* AI 身份隐藏 */}
              <div className="flex items-center justify-between pt-2 border-t border-border mt-2">
                <div>
                  <span className="text-xs text-textSecondary">🎭 隐藏 AI 身份</span>
                  <p className="text-[10px] text-textMuted mt-0.5">开启后系统提示词不出现"你是AI"</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hideAiIdentity}
                    onChange={(e) => setHideAiIdentity(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-600 rounded-full peer peer-checked:bg-primary-500 peer-focus:ring-2 peer-focus:ring-primary-500/30 after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                </label>
              </div>
              {/* 延迟回复 */}
              <div className="flex items-center justify-between pt-2 border-t border-border mt-2">
                <div>
                  <span className="text-xs text-textSecondary">⏱️ 延迟回复</span>
                  <p className="text-[10px] text-textMuted mt-0.5">控制 AI 是否可以使用延迟回复 Skill（清空=继承全局）</p>
                </div>
                <select
                  value={delayReplyEnabled === null ? 'inherit' : delayReplyEnabled ? 'on' : 'off'}
                  onChange={(e) => {
                    const v = e.target.value
                    setDelayReplyEnabled(v === 'inherit' ? null : v === 'on')
                  }}
                  className="text-xs px-2 py-1 rounded-lg border border-border bg-canvas text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                >
                  <option value="inherit">继承全局</option>
                  <option value="on">开启</option>
                  <option value="off">关闭</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* 独立 API 配置 */}
        <div className="bg-canvas rounded-xl p-4 border border-border mb-4">
          <h3 className="text-sm font-semibold text-textSecondary mb-3">🔗 独立 API 配置（留空继承全局）</h3>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-textMuted">API Base URL</label>
              <input
                type="text"
                value={agentApiBaseUrl}
                onChange={(e) => setAgentApiBaseUrl(e.target.value)}
                className="w-full mt-0.5 px-3 py-1.5 rounded-lg border border-border bg-canvas text-xs text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                placeholder="https://api.deepseek.com"
              />
            </div>
            <div>
              <label className="text-xs text-textMuted">API Key</label>
              <input
                type="password"
                value={agentApiKey}
                onChange={(e) => setAgentApiKey(e.target.value)}
                placeholder={agent.has_api_key ? '留空不修改（已设置）' : '留空不修改'}
                className="w-full mt-0.5 px-3 py-1.5 rounded-lg border border-border bg-canvas text-xs text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              />
              {agent.has_api_key && <p className="text-[10px] text-mint-400 mt-0.5">已设置独立 Key</p>}
            </div>
          </div>
        </div>

        {error && <div className="text-sm text-rose-400 mb-3">{error}</div>}

        {/* ── 预设切换预览确认 ── */}
        {presetPreview && (
          <div className="mb-4 bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-textPrimary mb-2">🔄 切换预设确认</h4>
            <p className="text-xs text-textSecondary mb-3">
              从 <b>{presetPreview.old_profile === 'custom' ? '自定义' : presetPreview.old_profile}</b> 切换至{' '}
              <b>{presetPreview.new_profile}</b>
              （{presetPreview.direction === 'upgrade' ? '⬆️ 升级' : '⬇️ 降级'}），
              以下 {Object.keys(presetPreview.changed_fields || {}).length} 项将变更：
            </p>
            {Object.keys(presetPreview.changed_fields || {}).length > 0 ? (
              <div className="space-y-1.5 mb-3 text-xs">
                {Object.entries(presetPreview.changed_fields as Record<string, {old: any; new: any}>).map(([key, v]: [string, any]) => (
                  <div key={key} className="flex items-center justify-between bg-canvas rounded-lg px-3 py-1.5">
                    <span className="text-textSecondary">{key}</span>
                    <span className="text-textMuted font-mono">
                      <span>{String(v.old)}</span>
                      <span className="mx-1.5">→</span>
                      <span className="text-mint-400 font-medium">{String(v.new)}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-textMuted mb-3">无需变更，当前值已满足新预设要求。</p>
            )}
            {presetPreview.independent_untouched?.length > 0 && (
              <p className="text-[10px] text-textMuted mb-3">
                🔒 以下参数不受预设影响保持不变：{presetPreview.independent_untouched.join('、')}
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={() => { setPresetPreview(null); setApplyingPreset(false) }}
                className="flex-1 py-1.5 text-xs border border-border rounded-lg hover:bg-elevated text-textSecondary transition-colors">
                取消
              </button>
              <button onClick={confirmApplyPreset} disabled={applyingPreset}
                className="flex-1 py-1.5 text-xs bg-primary-500 text-white rounded-lg hover:bg-primary-400 disabled:opacity-30 transition-all">
                {applyingPreset ? '应用中...' : '确认切换'}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-elevated text-textSecondary transition-colors font-medium">
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 py-2.5 text-sm bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-30 font-medium transition-all shadow-lg shadow-primary-500/20"
          >
            {loading ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ================================================================
   配置历史弹窗
   ================================================================ */
function HistoryModal({ agent, onClose, onRollback }: {
  agent: Agent; onClose: () => void; onRollback: () => void
}) {
  const [history, setHistory] = useState<ConfigHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [rollingBack, setRollingBack] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get(`/agents/${agent.id}/history`)
        setHistory(data)
      } catch (err: any) {
        setError(err.message || '加载历史失败')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [agent.id])

  const handleRollback = async (versionId: number) => {
    setRollingBack(versionId)
    setError('')
    try {
      await api.post(`/agents/${agent.id}/rollback/${versionId}`)
      onRollback()
    } catch (err: any) {
      setError(err.message || '回滚失败')
    } finally {
      setRollingBack(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-xl mx-4 max-h-[80vh] overflow-y-auto shadow-2xl shadow-black/30 pb-[var(--safe-bottom)] md:pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-textPrimary">{agent.name} · 配置历史</h2>
          <button onClick={onClose} className="p-1 hover:bg-elevated rounded-lg text-textMuted hover:text-textSecondary">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-textMuted text-sm">加载中...</div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-textMuted text-sm">暂无配置历史记录</div>
        ) : (
          <div className="space-y-3">
            {history.map((h, idx) => {
              const isLatest = idx === 0
              return (
                <div
                  key={h.id}
                  className={`rounded-xl p-4 border ${
                    isLatest
                      ? 'border-primary-500/30 bg-primary-500/5'
                      : 'border-border bg-canvas'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-textMuted">
                      {h.created_at ? new Date(h.created_at).toLocaleString('zh-CN') : '未知时间'}
                      {isLatest && <span className="ml-1 text-primary-400 font-medium">（当前）</span>}
                    </span>
                    {!isLatest && (
                      <button
                        onClick={() => handleRollback(h.id)}
                        disabled={rollingBack === h.id}
                        className="flex items-center gap-1 px-2 py-0.5 text-xs text-accent-400 hover:bg-accent-400/10 rounded-lg transition-colors disabled:opacity-30"
                      >
                        <RotateCcw size={11} />
                        {rollingBack === h.id ? '回滚中...' : '回滚到此'}
                      </button>
                    )}
                  </div>
                  {h.system_prompt && (
                    <p className="text-xs text-textSecondary line-clamp-2 whitespace-pre-wrap mb-1">
                      {h.system_prompt}
                    </p>
                  )}
                  <div className="text-xs text-textMuted flex gap-3">
                    <span>T: {h.temperature}</span>
                    <span>P: {h.top_p}</span>
                    <span>Pre: {h.presence_penalty}</span>
                    <span>Freq: {h.frequency_penalty}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {error && <div className="text-sm text-rose-400 mt-3">{error}</div>}
      </div>
    </div>
  )
}

/* ================================================================
   状态切换弹窗
   ================================================================ */
function StateModal({ agent, onClose, onUpdated }: {
  agent: Agent; onClose: () => void; onUpdated: () => void
}) {
  const [targetState, setTargetState] = useState(agent.state)
  const [durationHours, setDurationHours] = useState(1)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSwitch = async () => {
    if (targetState === agent.state) {
      onClose()
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.post(`/agents/${agent.id}/state`, {
        target_state: targetState,
        duration_hours: targetState === 'blocked' ? durationHours : undefined,
        reason: reason || undefined,
      })
      onUpdated()
    } catch (err: any) {
      setError(err.message || '切换失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl shadow-black/30 pb-[var(--safe-bottom)] md:pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-textPrimary">{agent.name} · 状态</h2>
          <button onClick={onClose} className="p-1 hover:bg-elevated rounded-lg text-textMuted hover:text-textSecondary">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1.5 text-textSecondary">当前: {stateLabels[agent.state] || agent.state}</label>
            <select
              value={targetState}
              onChange={(e) => setTargetState(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            >
              {Object.entries(stateLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {targetState === 'blocked' && (
            <div>
              <label className="block text-xs font-medium mb-1.5 text-textSecondary">封禁时长（小时，≤72）</label>
              <input
                type="number"
                min={1} max={72}
                value={durationHours}
                onChange={(e) => setDurationHours(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1.5 text-textSecondary">原因（可选）</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              placeholder="简短说明..."
            />
          </div>
        </div>

        {error && <div className="text-sm text-rose-400 mt-3">{error}</div>}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-elevated text-textSecondary transition-colors font-medium">
            取消
          </button>
          <button
            onClick={handleSwitch}
            disabled={loading || targetState === agent.state}
            className="flex-1 py-2.5 text-sm bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-30 font-medium transition-all shadow-lg shadow-primary-500/20"
          >
            {loading ? '切换中...' : '切换'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ================================================================
   创建 AI 弹窗
   ================================================================ */
/* ================================================================
   导入 AI 灵魂档案弹窗
   ================================================================ */
function ImportSoulModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [importMemories, setImportMemories] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<any>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setError('')
    try {
      const text = await f.text()
      const data = JSON.parse(text)
      setPreview(data)
    } catch {
      setError('文件格式无效，请选择 JSON 文件')
      setPreview(null)
    }
  }

  const handleImport = async () => {
    if (!file) return
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('access_token')
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/agents/import?import_memories=${importMemories}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '导入失败')
      }
      onImported()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl pb-[var(--safe-bottom)] md:pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-textPrimary">导入 AI 灵魂档案</h2>
          <button onClick={onClose} className="p-1 hover:bg-elevated rounded-lg text-textMuted hover:text-textSecondary">
            <X size={18} />
          </button>
        </div>

        <input
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="block w-full text-sm text-textPrimary file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:bg-elevated file:text-textPrimary hover:file:bg-border mb-3"
        />

        {preview && (
          <div className="bg-canvas rounded-xl p-3 mb-3 text-sm space-y-1">
            <p className="font-medium text-textPrimary">{preview.agent_name || '未命名'}</p>
            <p className="text-xs text-textSecondary">记忆数: {preview.memories?.length || 0}</p>
            <p className="text-xs text-textSecondary">好友数: {preview.friends?.length || 0}</p>
            <p className="text-xs text-textSecondary">配置历史: {preview.config_history?.length || 0} 条</p>
          </div>
        )}

        <label className="flex items-center gap-2 mb-4 text-sm text-textSecondary cursor-pointer">
          <input
            type="checkbox"
            checked={importMemories}
            onChange={(e) => setImportMemories(e.target.checked)}
            className="rounded"
          />
          导入记忆
        </label>

        {error && <div className="text-sm text-rose-400 mb-3">{error}</div>}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-elevated text-textSecondary transition-colors font-medium">
            取消
          </button>
          <button
            onClick={handleImport}
            disabled={!file || loading}
            className="flex-1 py-2.5 text-sm bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-30 font-medium transition-all shadow-lg shadow-primary-500/20"
          >
            {loading ? '导入中...' : '导入'}
          </button>
        </div>
      </div>
    </div>
  )
}

