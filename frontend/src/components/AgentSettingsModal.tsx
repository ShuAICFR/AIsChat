import { useState } from 'react'
import { api } from '../api/client'
import { useT } from '../i18n/I18nContext'
import { ArrowLeft, X, Loader2, RotateCw, Ticket } from 'lucide-react'

interface AgentData {
  id: number
  name: string
  current_system_prompt: string | null
  current_temperature: number | null
  current_top_p: number | null
  current_presence_penalty: number | null
  current_frequency_penalty: number | null
  thinking_enabled: boolean
  hide_ai_identity: boolean
  chat_model: string | null
  work_model: string | null
  max_tool_rounds: number
  alarm_max_tool_rounds: number
  force_alarm_on_end: boolean
  max_alarms: number
  memory_load_mode: string
  memory_recent_count: number
  memory_shared_scope: string
  ai_type: string
  delay_reply_enabled: boolean | null
  is_ai_editable: boolean
  allow_friend_requests: boolean
  auto_respond_friend_request: boolean
  api_credit_cost: number
  api_base_url: string | null
  has_api_key: boolean
  config_profile?: string
  reminder_grace?: string
  discoverable?: boolean
  allow_others_chat?: boolean
  others_chat_mode?: string
  others_chat_quota?: number
  others_chat_used?: number
  disallow_mode?: string
}

interface ModelOption {
  value: string
  label: string
}

interface Props {
  agent: AgentData
  modelOptions: ModelOption[]
  defaults: { chat_model: string; work_model: string }
  thinkingSupported: boolean
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}

export default function AgentSettingsModal({
  agent, modelOptions, defaults, thinkingSupported, isOpen, onClose, onSaved,
}: Props) {
  const t = useT()

  // Internal state initialized from agent
  const [name, setName] = useState(agent.name)
  const [systemPrompt, setSystemPrompt] = useState(agent.current_system_prompt || '')
  const [temperature, setTemperature] = useState(agent.current_temperature ?? agent.current_temperature ?? 0.8)
  const [topP, setTopP] = useState(agent.current_top_p ?? 0.9)
  const [presencePenalty, setPresencePenalty] = useState(agent.current_presence_penalty ?? 0)
  const [frequencyPenalty, setFrequencyPenalty] = useState(agent.current_frequency_penalty ?? 0)
  const [thinkingEnabled, setThinkingEnabled] = useState(agent.thinking_enabled)
  const [hideAiIdentity, setHideAiIdentity] = useState(agent.hide_ai_identity)
  const [chatModel, setChatModel] = useState(agent.chat_model || '')
  const [workModel, setWorkModel] = useState(agent.work_model || '')
  const [maxToolRounds, setMaxToolRounds] = useState(agent.max_tool_rounds)
  const [alarmMaxToolRounds, setAlarmMaxToolRounds] = useState(agent.alarm_max_tool_rounds)
  const [forceAlarmOnEnd, setForceAlarmOnEnd] = useState(agent.force_alarm_on_end)
  const [maxAlarms, setMaxAlarms] = useState(agent.max_alarms)
  const [memoryLoadMode, setMemoryLoadMode] = useState(agent.memory_load_mode || 'index_only')
  const [memoryRecentCount, setMemoryRecentCount] = useState(agent.memory_recent_count || 0)
  const [memorySharedScope, setMemorySharedScope] = useState(agent.memory_shared_scope || 'private_only')
  const [aiType, setAiType] = useState(agent.ai_type || 'resonance')
  const [delayReplyEnabled, setDelayReplyEnabled] = useState<boolean | null>(agent.delay_reply_enabled)
  const [isAiEditable, setIsAiEditable] = useState(agent.is_ai_editable)
  const [allowFriendRequests, setAllowFriendRequests] = useState(agent.allow_friend_requests)
  const [autoRespondFriendRequest, setAutoRespondFriendRequest] = useState(agent.auto_respond_friend_request)
  const [reminderGrace, setReminderGrace] = useState(agent.reminder_grace || 'every_time')
  const [discoverable, setDiscoverable] = useState(agent.discoverable ?? true)
  const [allowOthersChat, setAllowOthersChat] = useState(agent.allow_others_chat ?? true)
  const [othersChatMode, setOthersChatMode] = useState(agent.others_chat_mode || 'unlimited')
  const [othersChatQuota, setOthersChatQuota] = useState(agent.others_chat_quota ?? 30)
  const [othersChatUsed, setOthersChatUsed] = useState(agent.others_chat_used ?? 0)
  const [disallowMode, setDisallowMode] = useState(agent.disallow_mode || 'strict')
  const [apiCreditCost, setApiCreditCost] = useState(agent.api_credit_cost || 0)
  const [apiBaseUrl, setApiBaseUrl] = useState(agent.api_base_url || '')
  const [apiKey, setApiKey] = useState('')

  // UI state
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveOk, setSaveOk] = useState<boolean | null>(null)
  const [testingApi, setTestingApi] = useState(false)
  const [testApiMsg, setTestApiMsg] = useState('')
  const [testApiOk, setTestApiOk] = useState<boolean | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState('')
  const [redeemOk, setRedeemOk] = useState<boolean | null>(null)

  const handleTestApi = async () => {
    setTestingApi(true)
    setTestApiMsg('')
    try {
      const data = await api.post<{ ok: boolean; message: string }>('/user/test-api-connection', {
        api_base_url: apiBaseUrl || null,
        api_key: apiKey || null,
      })
      setTestApiOk(data.ok)
      setTestApiMsg(data.message || (data.ok ? t('modal.testSuccess') : t('modal.testFailed')))
    } catch (err: any) {
      setTestApiOk(false)
      setTestApiMsg(err.message || t('error.testFailed'))
    } finally {
      setTestingApi(false)
    }
  }

  const handleRedeem = async () => {
    if (!redeemCode.trim()) return
    setRedeeming(true)
    setRedeemMsg('')
    setRedeemOk(null)
    try {
      const data = await api.post<{ message: string }>('/user/redeem', { code: redeemCode.trim() })
      setRedeemOk(true)
      setRedeemMsg(data.message || t('modal.redeemSuccess'))
      setRedeemCode('')
    } catch (err: any) {
      setRedeemOk(false)
      setRedeemMsg(err.message || t('modal.redeemFailed'))
    } finally {
      setRedeeming(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg('')
    setSaveOk(null)
    try {
      const payload: Record<string, any> = {
        name,
        system_prompt: systemPrompt || null,
        temperature,
        top_p: topP,
        presence_penalty: presencePenalty,
        frequency_penalty: frequencyPenalty,
        thinking_enabled: thinkingEnabled,
        hide_ai_identity: hideAiIdentity,
        chat_model: chatModel || null,
        work_model: workModel || null,
        max_tool_rounds: maxToolRounds,
        alarm_max_tool_rounds: alarmMaxToolRounds,
        force_alarm_on_end: forceAlarmOnEnd,
        max_alarms: maxAlarms,
        memory_load_mode: memoryLoadMode,
        memory_recent_count: memoryRecentCount,
        memory_shared_scope: memorySharedScope,
        ai_type: aiType,
        delay_reply_enabled: delayReplyEnabled,
        is_ai_editable: isAiEditable,
        allow_friend_requests: allowFriendRequests,
        auto_respond_friend_request: autoRespondFriendRequest,
        reminder_grace: reminderGrace,
        discoverable,
        allow_others_chat: allowOthersChat,
        others_chat_mode: othersChatMode,
        others_chat_quota: othersChatQuota,
        others_chat_used: othersChatUsed,
        disallow_mode: disallowMode,
        api_credit_cost: apiCreditCost,
        api_base_url: apiBaseUrl || null,
      }
      if (apiKey.trim()) {
        payload.api_key = apiKey.trim()
      }
      await api.put(`/agents/${agent.id}/config`, payload)
      setSaveOk(true)
      setSaveMsg(t('modal.detailSettingsSaveAndClose') || 'Saved')
      setTimeout(() => {
        onSaved()
        onClose()
      }, 600)
    } catch (err: any) {
      setSaveOk(false)
      setSaveMsg(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

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
          <h2 className="text-base font-semibold text-textPrimary">{t('agentDetail.fullSettings')}</h2>
          <div className="w-6" />
        </div>

        {/* 桌面端头部 */}
        <div className="hidden md:flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-textPrimary">{t('agentDetail.fullSettings')}</h2>
          <button onClick={onClose} className="text-textMuted hover:text-textSecondary transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 flex-1 overflow-y-auto md:max-h-[65vh] pr-1 pb-[var(--safe-bottom)] md:pb-0">

          {/* ── 基础信息 ── */}
          <Section title={t('modal.detailSettingsBasicInfo')} desc={t('modal.detailSettingsBasicInfoDesc')}>
            {/* 配置档位（只读展示） */}
            {agent.config_profile && agent.config_profile !== 'custom' && (
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] text-textMuted">{t('agentDetail.configProfile')}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  agent.config_profile === 'chat' ? 'bg-blue-500/10 text-blue-400' :
                  agent.config_profile === 'immersive' ? 'bg-amber-500/10 text-amber-400' :
                  'bg-violet-500/10 text-violet-400'
                }`}>{t(`agentDetail.profile${agent.config_profile === 'chat' ? 'Chat' : agent.config_profile === 'immersive' ? 'Immersive' : 'DigitalLife'}`)}</span>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">{t('chat.groupName')}</label>
              <input
                type="text" value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">{t('modal.createAgentSystemPrompt')}</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none"
                placeholder={t('modal.createAgentSystemPromptPlaceholder')}
              />
            </div>
          </Section>

          {/* ── 模型参数 ── */}
          <Section title={t('modal.detailSettingsModelParams')} desc={t('modal.detailSettingsModelParamsDesc')}>
            <SliderField label="Temperature" value={temperature} setValue={setTemperature} min={0} max={2} step={0.1} desc={t('modal.detailSettingsTemperatureDesc')} />
            <SliderField label="Top P" value={topP} setValue={setTopP} min={0} max={1} step={0.05} desc={t('modal.detailSettingsTopPDesc')} />
            <SliderField label="Presence Penalty" value={presencePenalty} setValue={setPresencePenalty} min={-2} max={2} step={0.1} desc={t('modal.detailSettingsPresencePenaltyDesc')} />
            <SliderField label="Frequency Penalty" value={frequencyPenalty} setValue={setFrequencyPenalty} min={-2} max={2} step={0.1} desc={t('modal.detailSettingsFrequencyPenaltyDesc')} />
            {thinkingSupported && (
              <ToggleField label={t('modal.detailSettingsThinkingMode')} value={thinkingEnabled} setValue={setThinkingEnabled} desc={t('modal.detailSettingsThinkingModeDesc')} />
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1 text-textSecondary">
                  {t('modal.detailSettingsChatModel')} <span className="text-textMuted">({t('modal.detailSettingsDefaultLabel')} {defaults.chat_model})</span>
                </label>
                <select value={chatModel} onChange={(e) => setChatModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50">
                  <option value="">{t('modal.detailSettingsGlobalDefault')}</option>
                  {modelOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-textSecondary">
                  {t('modal.detailSettingsWorkModel')} <span className="text-textMuted">({t('modal.detailSettingsDefaultLabel')} {defaults.work_model})</span>
                </label>
                <select value={workModel} onChange={(e) => setWorkModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50">
                  <option value="">{t('modal.detailSettingsGlobalDefault')}</option>
                  {modelOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
          </Section>

          {/* ── 工具调用 ── */}
          <Section title={t('modal.detailSettingsToolCalls')} desc={t('modal.detailSettingsToolCallsDesc')}>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label={t('modal.detailSettingsMaxToolRounds')} value={maxToolRounds} setValue={setMaxToolRounds} min={1} max={20} desc={t('modal.detailSettingsMaxToolRoundsDesc')} />
              <NumberField label={t('modal.detailSettingsAlarmRounds')} value={alarmMaxToolRounds} setValue={setAlarmMaxToolRounds} min={1} max={30} desc={t('modal.detailSettingsAlarmRoundsDesc')} />
            </div>
          </Section>

          {/* ── 闹钟 / 心跳 ── */}
          <Section title={t('modal.detailSettingsAlarm')} desc={t('modal.detailSettingsAlarmDesc')}>
            <ToggleField label={t('modal.detailSettingsForceAlarm')} value={forceAlarmOnEnd} setValue={setForceAlarmOnEnd} desc={t('modal.detailSettingsForceAlarmDesc')} />
            <NumberField label={t('modal.detailSettingsMaxAlarms')} value={maxAlarms} setValue={setMaxAlarms} min={1} max={50} desc={t('modal.detailSettingsMaxAlarmsDesc')} />
          </Section>

          {/* ── 文件记忆 ── */}
          <Section title={t('modal.detailSettingsFileMemory')} desc={t('modal.detailSettingsFileMemoryDesc')}>
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">{t('modal.detailSettingsMemoryLoadMode')}</label>
              <select value={memoryLoadMode} onChange={(e) => setMemoryLoadMode(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50">
                <option value="index_only">{t('modal.detailSettingsMemoryLoadModeIndexOnly')}</option>
                <option value="index_plus_recent">{t('modal.detailSettingsMemoryLoadModeIndexRecent')}</option>
                <option value="index_plus_semantic">{t('modal.detailSettingsMemoryLoadModeIndexSemantic')}</option>
              </select>
              <p className="text-[10px] text-textMuted mt-1">{t('modal.detailSettingsMemoryLoadModeDesc')}</p>
            </div>
            {memoryLoadMode === 'index_plus_recent' && (
              <NumberField label={t('modal.detailSettingsMemoryRecentCount')} value={memoryRecentCount} setValue={setMemoryRecentCount} min={0} max={50} desc={t('modal.detailSettingsMemoryRecentCountDesc')} />
            )}
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">{t('modal.detailSettingsMemorySharedScope')}</label>
              <select value={memorySharedScope} onChange={(e) => setMemorySharedScope(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50">
                <option value="private_only">{t('modal.detailSettingsMemorySharedScopePrivate')}</option>
                <option value="private_plus_shared_by_user">{t('modal.detailSettingsMemorySharedScopeByUser')}</option>
                <option value="private_plus_shared_all">{t('modal.detailSettingsMemorySharedScopeAll')}</option>
              </select>
              <p className="text-[10px] text-textMuted mt-1">{t('modal.detailSettingsMemorySharedScopeDesc')}</p>
            </div>
          </Section>

          {/* ── AI 类型 ── */}
          <Section title={t('modal.detailSettingsAiType')} desc={t('modal.detailSettingsAiTypeDesc')}>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'general', label: t('modal.detailSettingsAiTypeGeneral'), desc: t('modal.detailSettingsAiTypeGeneralDesc') },
                { value: 'semi_general', label: t('modal.detailSettingsAiTypeSemiGeneral'), desc: t('modal.detailSettingsAiTypeSemiGeneralDesc') },
                { value: 'resonance', label: t('modal.detailSettingsAiTypeResonance'), desc: t('modal.detailSettingsAiTypeResonanceDesc') },
              ] as const).map((type) => (
                <button
                  key={type.value} type="button"
                  onClick={() => setAiType(type.value)}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-center transition-all ${
                    aiType === type.value
                      ? 'border-primary-400 bg-primary-500/10 text-primary-600 dark:text-primary-300'
                      : 'border-border bg-canvas text-textSecondary hover:bg-elevated'
                  }`}
                >
                  <span className="text-xs font-semibold">{type.label}</span>
                  <span className="text-[9px] leading-tight text-textMuted">{type.desc}</span>
                </button>
              ))}
            </div>
          </Section>

          {/* ── 行为开关 ── */}
          <Section title={t('modal.detailSettingsBehaviorSwitches')} desc={t('modal.detailSettingsBehaviorSwitchesDesc')}>
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">{t('modal.detailSettingsDelayReply')}</label>
              <select
                value={delayReplyEnabled === null ? 'inherit' : delayReplyEnabled ? 'on' : 'off'}
                onChange={(e) => {
                  const v = e.target.value
                  setDelayReplyEnabled(v === 'inherit' ? null : v === 'on')
                }}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              >
                <option value="inherit">{t('modal.detailSettingsInheritGlobal')}</option>
                <option value="on">{t('common.enabled')}</option>
                <option value="off">{t('common.disabled')}</option>
              </select>
            </div>
            <ToggleField label={t('modal.detailSettingsSelfEdit')} value={isAiEditable} setValue={setIsAiEditable} desc={t('modal.detailSettingsSelfEditDesc')} />
            <ToggleField label={t('modal.detailSettingsHideAiIdentity')} value={hideAiIdentity} setValue={setHideAiIdentity} desc={t('modal.detailSettingsHideAiIdentityDesc')} />
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">{t('modal.detailSettingsReminderGrace')}</label>
              <select value={reminderGrace} onChange={(e) => setReminderGrace(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50">
                <option value="every_time">{t('modal.detailSettingsReminderGraceEvery')}</option>
                <option value="once">{t('modal.detailSettingsReminderGraceOnce')}</option>
                <option value="off">{t('modal.detailSettingsReminderGraceOff')}</option>
              </select>
            </div>
          </Section>

          {/* ── 好友与社交 ── */}
          <Section title={t('modal.detailSettingsFriendsSocial')} desc={t('modal.detailSettingsFriendsSocialDesc')}>
            <ToggleField label={t('agents.discoverable')} value={discoverable} setValue={setDiscoverable} desc={t('agents.discoverableDesc')} />
            <ToggleField label={t('modal.detailSettingsAllowFriendRequests')} value={allowFriendRequests} setValue={setAllowFriendRequests} desc={t('modal.detailSettingsAllowFriendRequestsDesc')} />
            {allowFriendRequests && (
              <ToggleField label={t('modal.detailSettingsAutoRespondFriendRequest')} value={autoRespondFriendRequest} setValue={setAutoRespondFriendRequest} desc={t('modal.detailSettingsAutoRespondFriendRequestDesc')} />
            )}
          </Section>

          {/* ── 对话权限 ── */}
          <Section title={t('agents.allowOthersChat')} desc={t('agents.allowOthersChatDesc')}>
            <ToggleField label={t('agents.allowOthersChat')} value={allowOthersChat} setValue={setAllowOthersChat} desc={t('agents.allowOthersChatDesc')} />
            <div className={`ml-4 pl-3 border-l-2 transition-opacity ${allowOthersChat ? 'border-primary-400/30' : 'border-border/30 opacity-60'}`}>
              <label className="text-[11px] font-medium text-textMuted mb-2 block">{t('agents.othersChatQuotaLabel')} · {allowOthersChat ? 'ON' : 'OFF'}</label>
              <div className="flex items-center gap-3 mb-2">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="othersChatMode" value="unlimited" checked={othersChatMode === 'unlimited'} onChange={() => setOthersChatMode('unlimited')} className="text-primary-500" />
                  <span className="text-xs text-textSecondary">{t('agents.othersChatUnlimited')}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="othersChatMode" value="quota" checked={othersChatMode === 'quota'} onChange={() => setOthersChatMode('quota')} className="text-primary-500" />
                  <span className="text-xs text-textSecondary">{t('agents.othersChatQuota')}</span>
                </label>
              </div>
              {othersChatMode === 'quota' && (
                <div className="flex items-center gap-3 mb-2">
                  <NumberField label={t('agents.othersChatQuotaLabel')} value={othersChatQuota} setValue={setOthersChatQuota} min={1} max={9999} />
                  <div className="flex items-center gap-2 pt-5">
                    <span className="text-[11px] text-textMuted">{t('agents.othersChatUsed')}: {othersChatUsed}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api.post(`/agents/${agent.id}/reset-others-chat-used`)
                          setOthersChatUsed(0)
                        } catch { /* ignore */ }
                      }}
                      className="text-[10px] px-2 py-0.5 rounded border border-border text-textMuted hover:text-textSecondary transition-colors"
                    >
                      {t('agents.othersChatUsedReset')}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className={`ml-4 pl-3 border-l-2 transition-opacity ${!allowOthersChat ? 'border-rose-400/30' : 'border-border/30 opacity-60'}`}>
              <label className="text-[11px] font-medium text-textMuted mb-2 block">{t('agents.disallowModeLabel')} · {!allowOthersChat ? 'ON' : 'OFF'}</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="disallowMode" value="strict" checked={disallowMode === 'strict'} onChange={() => setDisallowMode('strict')} className="text-primary-500" />
                  <span className="text-xs text-textSecondary">{t('agents.disallowStrict')}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="disallowMode" value="own_key" checked={disallowMode === 'own_key'} onChange={() => setDisallowMode('own_key')} className="text-primary-500" />
                  <span className="text-xs text-textSecondary">{t('agents.disallowOwnKey')}</span>
                </label>
              </div>
            </div>
          </Section>

          {/* ── 额度 ── */}
          <Section title={t('modal.detailSettingsCreditCost')} desc={t('modal.detailSettingsCreditCostDesc')}>
            <NumberField label={t('modal.detailSettingsApiCreditCost')} value={apiCreditCost} setValue={setApiCreditCost} min={0} max={100000} desc={t('modal.detailSettingsApiCreditCostDesc')} />
          </Section>

          {/* ── API 提供商 ── */}
          <Section title={t('modal.detailSettingsApiProvider')} desc={t('modal.detailSettingsApiProviderDesc')}>
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">API Base URL</label>
              <input
                type="text" value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                placeholder={t('modal.detailSettingsApiBaseUrlPlaceholder')}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-textSecondary">API Key</label>
              <input
                type="password" value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                placeholder={agent.has_api_key ? '•••••••• (unchanged if empty)' : t('modal.detailSettingsApiKeyPlaceholder')}
              />
            </div>
            <button
              onClick={handleTestApi}
              disabled={testingApi || (!apiBaseUrl.trim() && !apiKey.trim())}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-textSecondary hover:bg-elevated disabled:opacity-40 transition-colors"
            >
              {testingApi ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
              {t('settings.testConnection')}
            </button>
            {testApiMsg && (
              <p className={`text-xs ${testApiOk === true ? 'text-mint-400' : 'text-rose-400'}`}>{testApiMsg}</p>
            )}
          </Section>

          {/* ── 兑换码 ── */}
          <Section title={t('modal.detailSettingsRedeemCode')} desc={t('modal.detailSettingsRedeemCodeDesc')}>
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Ticket size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
                <input
                  type="text" value={redeemCode}
                  onChange={(e) => setRedeemCode(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  placeholder={t('modal.detailSettingsRedeemPlaceholder')}
                />
              </div>
              <button
                onClick={handleRedeem}
                disabled={redeeming || !redeemCode.trim()}
                className="flex items-center gap-1 px-4 py-2 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-400 disabled:opacity-40 transition-colors shrink-0"
              >
                {redeeming ? <Loader2 size={14} className="animate-spin" /> : <span>{t('me.redeem')}</span>}
              </button>
            </div>
            {redeemMsg && (
              <p className={`text-xs ${redeemOk === false ? 'text-rose-400' : 'text-mint-400'}`}>{redeemMsg}</p>
            )}
          </Section>

        </div>

        {/* 保存 / 取消 */}
        {saveMsg && (
          <p className={`text-xs mt-2 text-center ${saveOk === false ? 'text-rose-400' : 'text-mint-400'}`}>{saveMsg}</p>
        )}
        <div className="flex gap-3 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm border border-border text-textSecondary rounded-xl hover:bg-elevated font-medium transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 text-sm bg-primary-500 text-white rounded-xl hover:bg-primary-400 font-medium transition-all shadow-lg shadow-primary-500/20 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin mx-auto" /> : t('common.save')}
          </button>
        </div>
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
function SliderField({ label, value, setValue, min, max, step, desc }: {
  label: string; value: number; setValue: (v: number) => void
  min: number; max: number; step: number; desc?: string
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <label className="text-xs text-textSecondary">{label}</label>
        <span className="text-xs font-mono text-textPrimary">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => setValue(parseFloat(e.target.value))}
        className="w-full accent-primary-500" />
      {desc && <p className="text-[10px] text-textMuted mt-0.5">{desc}</p>}
    </div>
  )
}

// ── 数字输入 ──
function NumberField({ label, value, setValue, min, max, desc }: {
  label: string; value: number; setValue: (v: number) => void
  min: number; max: number; desc?: string
}) {
  return (
    <div>
      <label className="block text-xs text-textSecondary mb-1">{label}</label>
      <input type="number" min={min} max={max} value={value}
        onChange={(e) => setValue(parseInt(e.target.value) || min)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50" />
      {desc && <p className="text-[10px] text-textMuted mt-0.5">{desc}</p>}
    </div>
  )
}

// ── 开关 ──
function ToggleField({ label, value, setValue, desc }: {
  label: string; value: boolean; setValue: (v: boolean) => void; desc?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <span className="text-xs text-textSecondary">{label}</span>
        {desc && <p className="text-[10px] text-textMuted">{desc}</p>}
      </div>
      <button
        type="button"
        onClick={() => setValue(!value)}
        className={`relative w-10 h-5.5 rounded-full transition-colors shrink-0 ml-3 ${
          value ? 'bg-primary-500' : 'bg-border'
        }`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          value ? 'left-5' : 'left-0.5'
        }`} />
      </button>
    </div>
  )
}
