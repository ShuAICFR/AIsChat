import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { STATE_BADGE_COLORS } from '../constants'
import Toggle from '../components/Toggle'
import { useT } from '../i18n/I18nContext'
import {
  ArrowLeft, Trash2, Download, Upload, Key, Edit3,
  Image, HardDrive, Brain, Copy, Check, X, RefreshCw, Bot,
  ScrollText, Loader2,
} from 'lucide-react'
import AvatarCropModal from '../components/AvatarCropModal'

interface Agent {
  id: number
  owner_id: number
  name: string
  state: string
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
  ai_type: string
  config_profile: string
  delay_reply_enabled: boolean | null
  max_tool_rounds: number
  alarm_max_tool_rounds: number
  force_alarm_on_end: boolean
  max_alarms: number
  allow_friend_requests: boolean
  auto_respond_friend_request: boolean
  api_credit_cost: number
  api_base_url: string | null
  has_api_key: boolean
  avatar_url: string | null
  api_token: string | null
  created_at: string
}

interface StorageInfo {
  total_size: number
  file_count: number
  quota_bytes: number
  quota_mb: number
  usage_percent: number
  files: Array<{ name: string; size: number; path: string }>
}

interface LogSummary {
  id: number
  agent_id: number
  conversation_type: string
  message_count: number
  token_usage: any
  has_output: boolean
  model: string | null
  thinking_enabled: boolean
  preview: any[]
  created_at: string | null
}

interface MemoryItem {
  id: number
  title: string
  content: string | null
  scope: string
  group_id: number | null
  created_at: string | null
}

interface WorkspaceFiles {
  todo: string
  plan: string
  journal: string
}

export default function AgentDetailPage() {
  const t = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, refreshUser } = useAuth()
  const agentId = parseInt(id || '0')

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'info' | 'memories' | 'storage' | 'workspace' | 'logs'>('info')

  // Delete
  const [showDelete, setShowDelete] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Prompt edit
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [savingPrompt, setSavingPrompt] = useState(false)

  // Token
  const [token, setToken] = useState<string | null>(null)
  const [tokenMasked, setTokenMasked] = useState<string | null>(null)
  const [generatingToken, setGeneratingToken] = useState(false)
  const [showToken, setShowToken] = useState(false)

  // Export / Import
  const [copied, setCopied] = useState(false)
  const [importing, setImporting] = useState(false)

  // Avatar
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)

  // Storage
  const [storage, setStorage] = useState<StorageInfo | null>(null)

  // Logs
  const [logs, setLogs] = useState<LogSummary[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [selectedLog, setSelectedLog] = useState<any>(null)
  const [logDetailLoading, setLogDetailLoading] = useState(false)
  const [logExporting, setLogExporting] = useState(false)

  // Memories
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [memPage, setMemPage] = useState(1)
  const [memTotal, setMemTotal] = useState(0)

  // Workspace
  const [workspace, setWorkspace] = useState<WorkspaceFiles>({ todo: '', plan: '', journal: '' })
  const [wsActive, setWsActive] = useState<'todo' | 'plan' | 'journal'>('todo')

  const loadWorkspace = useCallback(async () => {
    try {
      const data = await api.get<WorkspaceFiles>(`/agents/${agentId}/workspace`)
      setWorkspace(data)
    } catch { /* ignore */ }
  }, [agentId])

  const loadAgent = useCallback(async () => {
    try {
      const data = await api.get(`/agents/${agentId}`)
      setAgent(data)
      setPromptText(data.current_system_prompt || '')
    } catch {
      navigate('/agents')
    } finally {
      setLoading(false)
    }
  }, [agentId, navigate])

  const loadToken = useCallback(async () => {
    try {
      const data = await api.get(`/agents/${agentId}/token`)
      setTokenMasked(data.api_token)
    } catch { /* ignore */ }
  }, [agentId])

  const loadStorage = useCallback(async () => {
    try {
      const data = await api.get(`/agents/${agentId}/storage`)
      setStorage(data)
    } catch { /* ignore */ }
  }, [agentId])

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const data = await api.get(`/conversation-log/agents/${agentId}/logs?limit=50`)
      setLogs(data || [])
    } catch { setLogs([]) }
    finally { setLogsLoading(false) }
  }, [agentId])

  const openLogDetail = async (logId: number) => {
    setLogDetailLoading(true)
    setSelectedLog(null)
    try {
      const detail = await api.get(`/conversation-log/agents/${agentId}/logs/${logId}`)
      setSelectedLog(detail)
    } catch { /* silently fail */ }
    finally { setLogDetailLoading(false) }
  }

  const exportLog = async (logId: number, format: 'json' | 'md') => {
    setLogExporting(true)
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`/api/conversation-log/agents/${agentId}/logs/${logId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(t('error.exportFailed'))
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `log-${logId}.${format === 'md' ? 'md' : 'json'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
    finally { setLogExporting(false) }
  }

  const loadMemories = useCallback(async (page: number) => {
    try {
      const data = await api.get(`/agents/${agentId}/memories?page=${page}&page_size=20`)
      setMemories(data.items)
      setMemTotal(data.total)
      setMemPage(data.page)
    } catch { /* ignore */ }
  }, [agentId])

  useEffect(() => {
    loadAgent()
    loadToken()
  }, [loadAgent, loadToken])

  useEffect(() => {
    if (activeTab === 'storage') loadStorage()
    if (activeTab === 'logs') loadLogs()
    if (activeTab === 'memories') loadMemories(1)
    if (activeTab === 'workspace') loadWorkspace()
  }, [activeTab, loadStorage, loadLogs, loadMemories, loadWorkspace])

  // Delete handler
  const handleDelete = async () => {
    if (deleteConfirmName !== agent?.name) return
    setDeleting(true)
    try {
      await api.delete(`/agents/${agentId}`)
      refreshUser()
      navigate('/agents')
    } catch (err: any) {
      alert(err.message || t('error.saveFailed'))
    } finally {
      setDeleting(false)
    }
  }

  // Prompt save
  const handleSavePrompt = async () => {
    setSavingPrompt(true)
    try {
      const data = await api.put(`/agents/${agentId}/config`, { system_prompt: promptText })
      setAgent(data)
      setEditingPrompt(false)
    } catch (err: any) {
      alert(err.message || t('error.saveFailed'))
    } finally {
      setSavingPrompt(false)
    }
  }

  // delay_reply_enabled toggle (auto-save)
  const handleToggleDelayReply = async (value: boolean | null) => {
    try {
      const data = await api.put(`/agents/${agentId}/config`, { delay_reply_enabled: value })
      setAgent(data)
    } catch (err: any) {
      alert(err.message || t('error.saveFailed'))
    }
  }

  const handleUpdateAgentField = async (field: string, value: any) => {
    try {
      const data = await api.put(`/agents/${agentId}/config`, { [field]: value })
      setAgent(data)
    } catch (err: any) {
      alert(err.message || t('error.saveFailed'))
    }
  }

  // Token generation
  const handleGenerateToken = async () => {
    setGeneratingToken(true)
    try {
      const data = await api.post(`/agents/${agentId}/token`, {})
      setToken(data.api_token)
      setTokenMasked(null) // refresh
      await loadToken()
    } catch (err: any) {
      alert(err.message || t('error.operationFailed'))
    } finally {
      setGeneratingToken(false)
    }
  }

  // Export
  const handleExport = async () => {
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`/api/agents/${agentId}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `soul_${agent?.name || 'agent'}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(t('error.exportFailed'))
    }
  }

  // Copy JSON
  const handleCopyExport = async () => {
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`/api/agents/${agentId}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert(t('common.copied') + ' ' + t('error.operationFailed'))
    }
  }

  // Import
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('access_token')
      const res = await fetch(`/api/agents/import?import_memories=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || t('error.operationFailed'))
      }
      const data = await res.json()
      navigate(`/agents/${data.id}`)
    } catch (err: any) {
      alert(err.message || t('error.operationFailed'))
    } finally {
      setImporting(false)
    }
  }

  // Avatar upload
  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCropFile(file)
    e.target.value = ''
  }

  const handleCropConfirm = async (blob: Blob) => {
    setCropFile(null)
    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('file', blob, 'avatar.jpg')
      const token = localStorage.getItem('access_token')
      const res = await fetch(`/api/agents/${agentId}/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) throw new Error('上传失败')
      await loadAgent()
    } catch (err: any) {
      alert(err.message || t('error.uploadFailed').replace(' ({status})', ''))
    } finally {
      setUploadingAvatar(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-canvas">
        <div className="animate-spin w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!agent) return null

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 bg-canvas">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/agents')} className="text-textMuted hover:text-textPrimary transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-12 h-12 rounded-xl bg-primary-500/10 flex items-center justify-center overflow-hidden">
              {agent.avatar_url ? (
                <img src={agent.avatar_url} alt={agent.name} className="w-full h-full object-cover" />
              ) : (
                <Bot size={24} className="text-primary-400" />
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold text-textPrimary">{agent.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${STATE_BADGE_COLORS[agent.state] || ''}`}>
                  {agent.state}
                </span>
                {agent.ai_type && agent.ai_type !== 'resonance' && (
                  <span className="text-xs px-2 py-0.5 rounded-full border border-accent-400/40 bg-accent-400/10 text-accent-400">
                    {agent.ai_type === 'general' ? t('agentDetail.aiTypeGeneral') : t('agentDetail.aiTypeSemiGeneral')}
                  </span>
                )}
                <span className="text-xs text-textMuted">
                  {t('agentDetail.createdOn')} {new Date(agent.created_at).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-border overflow-x-auto">
          {(['info', 'memories', 'storage', 'workspace', 'logs'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-textMuted hover:text-textSecondary'
              }`}
            >
              {tab === 'info' ? t('agentDetail.tabInfo') : tab === 'memories' ? t('agentDetail.tabMemories') : tab === 'storage' ? t('agentDetail.tabStorage') : tab === 'workspace' ? t('agentDetail.tabWorkspace') : t('agentDetail.tabLogs')}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'info' && (
          <div className="space-y-4">
            {/* Quick Edit Prompt */}
            <div className="bg-surface rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Edit3 size={16} className="text-primary-400" />
                  <h3 className="font-medium text-textPrimary text-sm">{t('agentDetail.systemPrompt')}</h3>
                </div>
                {!editingPrompt ? (
                  <button
                    onClick={() => { setEditingPrompt(true); setPromptText(agent.current_system_prompt || '') }}
                    className="text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 transition-colors"
                  >
                    {t('common.edit')}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => setEditingPrompt(false)} className="text-xs text-textMuted hover:text-textSecondary">
                      <X size={14} />
                    </button>
                    <button onClick={handleSavePrompt} disabled={savingPrompt} className="text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300">
                      {savingPrompt ? '...' : <Check size={14} />}
                    </button>
                  </div>
                )}
              </div>
              {editingPrompt ? (
                <textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-y"
                />
              ) : (
                <p className="text-sm text-textSecondary leading-relaxed whitespace-pre-wrap">
                  {agent.current_system_prompt || t('agentDetail.notSet')}
                </p>
              )}
            </div>

            {/* Config Info */}
            <div className="bg-surface rounded-xl border border-border p-4">
              <h3 className="font-medium text-textPrimary text-sm mb-3">{t('agentDetail.modelConfig')}</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-textMuted">{t('agentDetail.chatModel')}</span>
                  <span className="text-textPrimary">{agent.chat_model || t('common.default')}</span>
                </div>
                <div>
                  <span className="text-textMuted">{t('agentDetail.workModel')}</span>
                  <span className="text-textPrimary">{agent.work_model || t('common.default')}</span>
                </div>
                <div>
                  <span className="text-textMuted">{t('agentDetail.temperature')}</span>
                  <span className="text-textPrimary">{agent.current_temperature}</span>
                </div>
                <div>
                  <span className="text-textMuted">{t('agentDetail.topP')}</span>
                  <span className="text-textPrimary">{agent.current_top_p}</span>
                </div>
                <div>
                  <span className="text-textMuted">{t('agentDetail.thinking')}</span>
                  <span className="text-textPrimary">{agent.thinking_enabled ? t('agentDetail.enabled') : t('agentDetail.disabled')}</span>
                </div>
                <div>
                  <span className="text-textMuted">{t('agentDetail.aiIdentity')}</span>
                  <span className="text-textPrimary">{agent.hide_ai_identity ? t('agentDetail.hidden') : t('agentDetail.normal')}</span>
                </div>
                <div>
                  <span className="text-textMuted">{t('agentDetail.configProfile')}</span>
                  <span className="text-textPrimary">
                    {agent.config_profile === 'chat' ? t('agentDetail.profileChat') :
                     agent.config_profile === 'immersive' ? t('agentDetail.profileImmersive') :
                     agent.config_profile === 'digital_life' ? t('agentDetail.profileDigitalLife') : t('agentDetail.profileCustom')}
                  </span>
                </div>
                <div>
                  <span className="text-textMuted">{t('agentDetail.delayReply')}</span>
                  <select
                    value={agent.delay_reply_enabled === null ? 'inherit' : agent.delay_reply_enabled ? 'on' : 'off'}
                    onChange={(e) => {
                      const v = e.target.value
                      handleToggleDelayReply(v === 'inherit' ? null : v === 'on')
                    }}
                    className="text-xs px-2 py-0.5 rounded border border-border bg-canvas text-textPrimary focus:outline-none focus:ring-1 focus:ring-primary-500/50"
                  >
                    <option value="inherit">{t('agentDetail.inheritGlobal')}</option>
                    <option value="on">{t('agentDetail.enabled')}</option>
                    <option value="off">{t('agentDetail.disabled')}</option>
                  </select>
                </div>
              </div>
              {/* 工具调用 & 闹钟 */}
              <div className="mt-4 pt-4 border-t border-border/60">
                <h4 className="text-xs font-medium text-textSecondary mb-3">{t('agentDetail.toolCallsAndAlarms')}</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-textMuted">{t('agentDetail.maxToolRounds')}</span>
                    <span className="inline-flex items-center gap-1 ml-1">
                      <button
                        onClick={() => handleUpdateAgentField('max_tool_rounds', Math.max(1, (agent.max_tool_rounds || 3) - 1))}
                        className="w-5 h-5 rounded bg-canvas border border-border text-textMuted hover:text-textPrimary text-xs"
                      >−</button>
                      <span className="text-textPrimary font-mono w-5 text-center">{agent.max_tool_rounds || 3}</span>
                      <button
                        onClick={() => handleUpdateAgentField('max_tool_rounds', Math.min(20, (agent.max_tool_rounds || 3) + 1))}
                        className="w-5 h-5 rounded bg-canvas border border-border text-textMuted hover:text-textPrimary text-xs"
                      >+</button>
                    </span>
                  </div>
                  <div>
                    <span className="text-textMuted">{t('agentDetail.alarmMaxRounds')}</span>
                    <span className="inline-flex items-center gap-1 ml-1">
                      <button
                        onClick={() => handleUpdateAgentField('alarm_max_tool_rounds', Math.max(1, (agent.alarm_max_tool_rounds || 10) - 1))}
                        className="w-5 h-5 rounded bg-canvas border border-border text-textMuted hover:text-textPrimary text-xs"
                      >−</button>
                      <span className="text-textPrimary font-mono w-5 text-center">{agent.alarm_max_tool_rounds || 10}</span>
                      <button
                        onClick={() => handleUpdateAgentField('alarm_max_tool_rounds', Math.min(50, (agent.alarm_max_tool_rounds || 10) + 1))}
                        className="w-5 h-5 rounded bg-canvas border border-border text-textMuted hover:text-textPrimary text-xs"
                      >+</button>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-textMuted">{t('agentDetail.forceAlarm')}</span>
                    <Toggle checked={agent.force_alarm_on_end} onChange={(v) => handleUpdateAgentField('force_alarm_on_end', v)} />
                  </div>
                  <div>
                    <span className="text-textMuted">{t('agentDetail.maxAlarms')}</span>
                    <span className="inline-flex items-center gap-1 ml-1">
                      <button
                        onClick={() => handleUpdateAgentField('max_alarms', Math.max(1, (agent.max_alarms || 10) - 1))}
                        className="w-5 h-5 rounded bg-canvas border border-border text-textMuted hover:text-textPrimary text-xs"
                      >−</button>
                      <span className="text-textPrimary font-mono w-5 text-center">{agent.max_alarms || 10}</span>
                      <button
                        onClick={() => handleUpdateAgentField('max_alarms', Math.min(50, (agent.max_alarms || 10) + 1))}
                        className="w-5 h-5 rounded bg-canvas border border-border text-textMuted hover:text-textPrimary text-xs"
                      >+</button>
                    </span>
                  </div>
                </div>
              </div>
              {/* 好友与社交 */}
              <div className="mt-4 pt-4 border-t border-border/60">
                <h4 className="text-xs font-medium text-textSecondary mb-3">{t('agentDetail.friendsAndSocial')}</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-textMuted">{t('agentDetail.allowFriendRequests')}</span>
                    <Toggle checked={agent.allow_friend_requests} onChange={(v) => handleUpdateAgentField('allow_friend_requests', v)} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-textMuted">{t('agentDetail.autoRespondRequests')}</span>
                    <Toggle checked={agent.auto_respond_friend_request} onChange={(v) => handleUpdateAgentField('auto_respond_friend_request', v)} disabled={!agent.allow_friend_requests} />
                  </div>
                </div>
              </div>
            </div>

            {/* API Config */}
            <div className="bg-surface rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <Key size={16} className="text-primary-400" />
                <h3 className="font-medium text-textPrimary text-sm">{t('agentDetail.apiConfig')}</h3>
              </div>
              <div className="text-sm space-y-1">
                <p>
                  <span className="text-textMuted">{t('agentDetail.apiBaseUrl')}</span>
                  <span className="text-textPrimary">{agent.api_base_url || t('agentDetail.inheritGlobal')}</span>
                </p>
                <p>
                  <span className="text-textMuted">{t('agentDetail.apiKey')}</span>
                  <span className="text-textPrimary">{agent.has_api_key ? t('agentDetail.apiKeySet') : t('agentDetail.inheritGlobal')}</span>
                </p>
                <p>
                  <span className="text-textMuted">{t('agentDetail.apiCreditCost')}</span>
                  <span className="text-textPrimary">{agent.api_credit_cost}</span>
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="bg-surface rounded-xl border border-border p-4">
              <h3 className="font-medium text-textPrimary text-sm mb-3">{t('agentDetail.actions')}</h3>
              <div className="flex flex-wrap gap-2">
                {/* Export */}
                <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-textSecondary hover:text-textPrimary hover:border-primary-500/30 transition-colors">
                  <Download size={14} /> {t('agentDetail.downloadExport')}
                </button>
                <button onClick={handleCopyExport} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-textSecondary hover:text-textPrimary hover:border-primary-500/30 transition-colors">
                  {copied ? <Check size={14} className="text-mint-400" /> : <Copy size={14} />}
                  {copied ? t('agentDetail.copied') : t('agentDetail.copyJson')}
                </button>

                {/* Import */}
                <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-textSecondary hover:text-textPrimary hover:border-primary-500/30 transition-colors cursor-pointer">
                  <Upload size={14} />
                  {importing ? t('common.saving') : t('agentDetail.importSoul')}
                  <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                </label>

                {/* Avatar */}
                <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-textSecondary hover:text-textPrimary hover:border-primary-500/30 transition-colors cursor-pointer">
                  <Image size={14} />
                  {uploadingAvatar ? t('me.uploadingAvatar') : t('agentDetail.changeAvatar')}
                  <input type="file" accept="image/*" onChange={handleAvatarSelect} className="hidden" />
                </label>

                {/* Token */}
                <button onClick={handleGenerateToken} disabled={generatingToken} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-textSecondary hover:text-textPrimary hover:border-primary-500/30 transition-colors disabled:opacity-50">
                  <RefreshCw size={14} className={generatingToken ? 'animate-spin' : ''} />
                  {tokenMasked ? `Token: ${tokenMasked}` : t('agentDetail.generateToken')}
                </button>
                {token && (
                  <div className="w-full flex items-center gap-2 mt-2 p-2 rounded-lg bg-amber-400/5 border border-amber-400/20">
                    <code className="text-xs text-amber-400 flex-1 break-all">{token}</code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(token); setToken(null) }}
                      className="text-xs text-amber-400 hover:text-amber-500 dark:hover:text-amber-300"
                    >
                      {t('agentDetail.copyOnce')}
                    </button>
                  </div>
                )}

                {/* Delete */}
                <button onClick={() => setShowDelete(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-500/20 text-sm text-rose-400 hover:bg-rose-500/10 transition-colors">
                  <Trash2 size={14} /> {t('agentDetail.deleteAgent')}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'storage' && (
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-4">
              <HardDrive size={16} className="text-primary-400" />
              <h3 className="font-medium text-textPrimary text-sm">{t('agentDetail.storageTitle')}</h3>
            </div>
            {storage ? (
              <>
                {/* 进度条 */}
                <div className="mb-4">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-textSecondary">
                      {t('agentDetail.storageUsed')} {formatSize(storage.total_size)} / {storage.quota_mb}MB
                    </span>
                    <span className={`font-medium ${
                      storage.usage_percent > 90 ? 'text-rose-400' :
                      storage.usage_percent > 70 ? 'text-amber-400' :
                      'text-mint-400'
                    }`}>
                      {storage.usage_percent}%
                    </span>
                  </div>
                  <div className="w-full h-3 rounded-full bg-canvas border border-border overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        storage.usage_percent > 90 ? 'bg-rose-400' :
                        storage.usage_percent > 70 ? 'bg-amber-400' :
                        'bg-mint-400'
                      }`}
                      style={{ width: `${Math.min(storage.usage_percent, 100)}%` }}
                    />
                  </div>
                  {storage.usage_percent > 90 && (
                    <p className="text-xs text-rose-400 mt-1">{t('agentDetail.storageAlmostFull')}</p>
                  )}
                </div>

                {/* 统计卡片 */}
                <div className="flex gap-3 mb-4 text-sm">
                  <div className="flex-1 px-3 py-2 rounded-lg bg-canvas border border-border text-center">
                    <div className="text-textMuted text-xs">{t('agentDetail.fileCountLabel')}</div>
                    <div className="text-textPrimary font-semibold">{storage.file_count}</div>
                  </div>
                  <div className="flex-1 px-3 py-2 rounded-lg bg-canvas border border-border text-center">
                    <div className="text-textMuted text-xs">{t('agentDetail.totalSize')}</div>
                    <div className="text-textPrimary font-semibold">{formatSize(storage.total_size)}</div>
                  </div>
                  <div className="flex-1 px-3 py-2 rounded-lg bg-canvas border border-border text-center">
                    <div className="text-textMuted text-xs">{t('agentDetail.quotaLabel')}</div>
                    <div className="text-textPrimary font-semibold">{storage.quota_mb}MB</div>
                  </div>
                </div>

                {storage.files.length > 0 ? (
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {storage.files.map((f, i) => (
                      <div key={i} className="flex justify-between text-xs py-1.5 px-2 rounded hover:bg-canvas">
                        <span className="text-textSecondary truncate flex-1 mr-2">{f.name}</span>
                        <span className="text-textMuted shrink-0">{formatSize(f.size)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-textMuted">{t('agentDetail.noFiles')}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-textMuted">{t('agentDetail.storageLoading')}</p>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <ScrollText size={16} className="text-primary-400" />
              <h3 className="font-medium text-textPrimary text-sm">{t('agentDetail.logTitle')}</h3>
              {logs.length > 0 && (
                <span className="text-xs text-textMuted ml-auto">{logs.length} {t('agentDetail.logCountSuffix')}</span>
              )}
            </div>
            {logsLoading ? (
              <div className="flex items-center gap-2 text-sm text-textMuted py-4 justify-center">
                <Loader2 size={14} className="animate-spin" /> {t('agentDetail.storageLoading')}
              </div>
            ) : logs.length === 0 ? (
              <p className="text-sm text-textMuted py-4 text-center">
                {t('agentDetail.logsEmpty')}<br />
                <span className="text-xs">{t('agentDetail.logsEmptyHint')}</span>
              </p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {logs.map((log) => (
                  <div key={log.id} className="p-3 rounded-lg bg-canvas border border-border">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-400">
                          {log.conversation_type === 'dm' ? t('agentDetail.logTypeDm') : t('agentDetail.logTypeGroup')}
                        </span>
                        <span className="text-xs text-textMuted">
                          {log.message_count} {t('agentDetail.logMessageCount')}
                        </span>
                        {log.has_output && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-mint-500/10 text-mint-400">
                            {t('agentDetail.logHasOutput')}
                          </span>
                        )}
                        {log.thinking_enabled && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                            {t('agentDetail.logThinking')}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-textMuted">
                        {log.created_at ? new Date(log.created_at).toLocaleString('zh-CN') : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => openLogDetail(log.id)}
                        className="text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 transition-colors"
                      >
                        {t('agentDetail.logViewDetail')}
                      </button>
                      <button
                        onClick={() => exportLog(log.id, 'json')}
                        disabled={logExporting}
                        className="text-xs text-textMuted hover:text-textSecondary transition-colors"
                      >
                        {t('agentDetail.logDownloadJson')}
                      </button>
                      <button
                        onClick={() => exportLog(log.id, 'md')}
                        disabled={logExporting}
                        className="text-xs text-textMuted hover:text-textSecondary transition-colors"
                      >
                        {t('agentDetail.logDownloadMd')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 日志详情弹窗 */}
            {selectedLog && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSelectedLog(null)}>
                <div
                  className="bg-surface rounded-xl border border-border max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col shadow-2xl"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <h4 className="font-medium text-sm text-textPrimary">
                      {t('agentDetail.logDetailTitle')} #{selectedLog.id}
                      <span className="text-textMuted ml-2 text-xs">
                        {selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString('zh-CN') : ''}
                      </span>
                    </h4>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => exportLog(selectedLog.id, 'json')}
                        className="text-xs px-2 py-1 rounded border border-border hover:bg-canvas text-textSecondary transition-colors"
                      >
                        {t('agentDetail.logDownloadJson')}
                      </button>
                      <button
                        onClick={() => exportLog(selectedLog.id, 'md')}
                        className="text-xs px-2 py-1 rounded border border-border hover:bg-canvas text-textSecondary transition-colors"
                      >
                        {t('agentDetail.logDownloadMd')}
                      </button>
                      <button onClick={() => setSelectedLog(null)} className="p-1 rounded hover:bg-elevated text-textMuted">
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {(selectedLog.messages || []).map((msg: any, i: number) => (
                      <div key={i} className={`text-xs p-2 rounded ${
                        msg.role === 'system' ? 'bg-canvas text-textMuted italic' :
                        msg.role === 'user' ? 'bg-primary-500/10 text-primary-600 dark:text-primary-300' :
                        msg.role === 'assistant' ? 'bg-mint-500/10 text-mint-500 dark:text-mint-400' :
                        'bg-amber-500/10 text-accent-600 dark:text-accent-300'
                      }`}>
                        <span className="font-medium">{msg.role}</span>
                        {msg.reasoning_content && (
                          <details className="mt-1">
                            <summary className="text-textMuted cursor-pointer">{t('agentDetail.logReasoning')}</summary>
                            <pre className="mt-1 whitespace-pre-wrap text-textMuted">{msg.reasoning_content}</pre>
                          </details>
                        )}
                        <p className="mt-1 whitespace-pre-wrap">
                          {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}
                        </p>
                        {msg.tool_calls && (
                          <div className="mt-1 text-textMuted">
                            {t('agentDetail.logToolCalls')} {msg.tool_calls.map((tc: any) => tc.function?.name || tc.name || '?').join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'memories' && (
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Brain size={16} className="text-primary-400" />
              <h3 className="font-medium text-textPrimary text-sm">{t('agentDetail.memoryTitlePrefix')}{memTotal}{t('agentDetail.memoryTitleSuffix')}</h3>
            </div>
            {memories.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {memories.map((m) => (
                  <div key={m.id} className="p-3 rounded-lg bg-canvas border border-border">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium text-textPrimary">{m.title}</span>
                      <span className="text-xs text-textMuted">{m.scope}</span>
                    </div>
                    {m.content && (
                      <p className="text-xs text-textSecondary line-clamp-2">{m.content}</p>
                    )}
                    <p className="text-xs text-textMuted mt-1">
                      {m.created_at ? new Date(m.created_at).toLocaleString('zh-CN') : ''}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-textMuted">{t('agentDetail.noMemories')}</p>
            )}
            {memTotal > 20 && (
              <div className="flex justify-center gap-2 mt-4">
                <button
                  onClick={() => loadMemories(memPage - 1)}
                  disabled={memPage <= 1}
                  className="px-3 py-1 text-xs rounded-lg border border-border text-textSecondary hover:text-textPrimary disabled:opacity-30"
                >
                  {t('agentDetail.prevPage')}
                </button>
                <span className="text-xs text-textMuted py-1">{memPage} / {Math.ceil(memTotal / 20)}</span>
                <button
                  onClick={() => loadMemories(memPage + 1)}
                  disabled={memPage >= Math.ceil(memTotal / 20)}
                  className="px-3 py-1 text-xs rounded-lg border border-border text-textSecondary hover:text-textPrimary disabled:opacity-30"
                >
                  {t('agentDetail.nextPage')}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'workspace' && (
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Edit3 size={16} className="text-primary-400" />
              <h3 className="font-medium text-textPrimary text-sm">{t('agentDetail.workspaceTitle')}</h3>
              <span className="text-xs text-textMuted ml-auto">{t('agentDetail.workspaceHint')}</span>
            </div>
            {/* Sub-tabs */}
            <div className="flex gap-1 mb-3 border-b border-border">
              {(['todo', 'plan', 'journal'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setWsActive(f)}
                  className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                    wsActive === f
                      ? 'border-primary-500 text-primary-400'
                      : 'border-transparent text-textMuted hover:text-textSecondary'
                  }`}
                >
                  {f === 'todo' ? t('agentDetail.workspaceTodoLabel') : f === 'plan' ? t('agentDetail.workspacePlanLabel') : t('agentDetail.workspaceJournalLabel')}
                </button>
              ))}
            </div>
            {/* Content */}
            <pre className="text-xs text-textSecondary whitespace-pre-wrap max-h-80 overflow-y-auto p-3 rounded-lg bg-canvas border border-border leading-relaxed font-mono min-h-[120px]">
              {workspace[wsActive] || `（${wsActive === 'todo' ? t('agentDetail.workspaceTodoLabel') : wsActive === 'plan' ? t('agentDetail.workspacePlanLabel') : t('agentDetail.workspaceJournalLabel')} ${t('agentDetail.workspaceEmptySuffix')}`}
            </pre>
          </div>
        )}
      </div>

      {/* Delete Confirm Modal */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-2xl border border-border p-6 w-full max-w-sm mx-4 pb-[var(--safe-bottom)] md:pb-6">
            <h3 className="text-lg font-bold text-textPrimary mb-2">{t('agentDetail.deleteConfirmTitle')}</h3>
            <p className="text-sm text-textSecondary mb-4">
              {t('agentDetail.deleteConfirmText')}<span className="text-mint-400 font-medium">{agent.api_credit_cost}</span> {t('agentDetail.deleteConfirmText2')}
              <span className="text-rose-400 font-medium">"{agent.name}"</span> {t('agentDetail.deleteConfirm')}
            </p>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-rose-500/50 mb-4"
              placeholder={agent.name}
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowDelete(false); setDeleteConfirmName('') }}
                className="flex-1 px-4 py-2 rounded-xl border border-border text-sm text-textSecondary hover:text-textPrimary"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmName !== agent.name || deleting}
                className="flex-1 px-4 py-2 rounded-xl bg-rose-500 text-white text-sm font-medium hover:bg-rose-400 disabled:opacity-30 transition-colors"
              >
                {deleting ? t('agentDetail.deleting') : t('agentDetail.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 头像裁剪弹窗 */}
      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropFile(null)}
        />
      )}
    </div>
  )
}
