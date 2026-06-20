import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import {
  ArrowLeft, Trash2, Download, Upload, Key, Edit3,
  Image, HardDrive, Brain, Copy, Check, X, RefreshCw, Bot,
} from 'lucide-react'

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
  files: Array<{ name: string; size: number; path: string }>
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
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, refreshUser } = useAuth()
  const agentId = parseInt(id || '0')

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'info' | 'memories' | 'storage' | 'workspace'>('info')

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

  // Storage
  const [storage, setStorage] = useState<StorageInfo | null>(null)

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
    if (activeTab === 'memories') loadMemories(1)
    if (activeTab === 'workspace') loadWorkspace()
  }, [activeTab, loadStorage, loadMemories, loadWorkspace])

  // Delete handler
  const handleDelete = async () => {
    if (deleteConfirmName !== agent?.name) return
    setDeleting(true)
    try {
      await api.delete(`/agents/${agentId}`)
      refreshUser()
      navigate('/agents')
    } catch (err: any) {
      alert(err.message || '删除失败')
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
      alert(err.message || '保存失败')
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
      alert(err.message || '更新失败')
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
      alert(err.message || '生成失败')
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
      alert('导出失败')
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
      alert('复制失败')
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
        throw new Error(err.detail || '导入失败')
      }
      const data = await res.json()
      navigate(`/agents/${data.id}`)
    } catch (err: any) {
      alert(err.message || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  // Avatar upload
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const token = localStorage.getItem('access_token')
      const res = await fetch(`/api/agents/${agentId}/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) throw new Error('上传失败')
      await loadAgent()
    } catch (err: any) {
      alert(err.message || '上传失败')
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

  const stateColors: Record<string, string> = {
    active: 'bg-mint-400/10 text-mint-400 border-mint-400/20',
    dnd: 'bg-rose-400/10 text-rose-400 border-rose-400/20',
    offline: 'bg-textMuted/10 text-textMuted border-textMuted/20',
    blocked: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
  }

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
                <span className={`text-xs px-2 py-0.5 rounded-full border ${stateColors[agent.state] || ''}`}>
                  {agent.state}
                </span>
                {agent.ai_type && agent.ai_type !== 'resonance' && (
                  <span className="text-xs px-2 py-0.5 rounded-full border border-accent-400/40 bg-accent-400/10 text-accent-400">
                    {agent.ai_type === 'general' ? '👤 通用' : '🔄 半通用'}
                  </span>
                )}
                <span className="text-xs text-textMuted">
                  创建于 {new Date(agent.created_at).toLocaleDateString('zh-CN')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-border">
          {(['info', 'memories', 'storage', 'workspace'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-textMuted hover:text-textSecondary'
              }`}
            >
              {t === 'info' ? '基本信息' : t === 'memories' ? '记忆' : t === 'storage' ? '存储' : '工作区'}
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
                  <h3 className="font-medium text-textPrimary text-sm">系统提示词</h3>
                </div>
                {!editingPrompt ? (
                  <button
                    onClick={() => { setEditingPrompt(true); setPromptText(agent.current_system_prompt || '') }}
                    className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                  >
                    编辑
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => setEditingPrompt(false)} className="text-xs text-textMuted hover:text-textSecondary">
                      <X size={14} />
                    </button>
                    <button onClick={handleSavePrompt} disabled={savingPrompt} className="text-xs text-primary-400 hover:text-primary-300">
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
                  {agent.current_system_prompt || '（未设置）'}
                </p>
              )}
            </div>

            {/* Config Info */}
            <div className="bg-surface rounded-xl border border-border p-4">
              <h3 className="font-medium text-textPrimary text-sm mb-3">模型配置</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-textMuted">聊天模型：</span>
                  <span className="text-textPrimary">{agent.chat_model || '默认'}</span>
                </div>
                <div>
                  <span className="text-textMuted">工作模型：</span>
                  <span className="text-textPrimary">{agent.work_model || '默认'}</span>
                </div>
                <div>
                  <span className="text-textMuted">Temperature：</span>
                  <span className="text-textPrimary">{agent.current_temperature}</span>
                </div>
                <div>
                  <span className="text-textMuted">Top P：</span>
                  <span className="text-textPrimary">{agent.current_top_p}</span>
                </div>
                <div>
                  <span className="text-textMuted">深度推理：</span>
                  <span className="text-textPrimary">{agent.thinking_enabled ? '🧠 开启' : '关闭'}</span>
                </div>
                <div>
                  <span className="text-textMuted">AI 身份：</span>
                  <span className="text-textPrimary">{agent.hide_ai_identity ? '隐藏' : '正常'}</span>
                </div>
                <div>
                  <span className="text-textMuted">配置档位：</span>
                  <span className="text-textPrimary">
                    {agent.config_profile === 'chat' ? '聊天档' :
                     agent.config_profile === 'immersive' ? '深度沉浸档' :
                     agent.config_profile === 'digital_life' ? '数字生命档' : '自定义'}
                  </span>
                </div>
                <div>
                  <span className="text-textMuted">延迟回复：</span>
                  <select
                    value={agent.delay_reply_enabled === null ? 'inherit' : agent.delay_reply_enabled ? 'on' : 'off'}
                    onChange={(e) => {
                      const v = e.target.value
                      handleToggleDelayReply(v === 'inherit' ? null : v === 'on')
                    }}
                    className="text-xs px-2 py-0.5 rounded border border-border bg-canvas text-textPrimary focus:outline-none focus:ring-1 focus:ring-primary-500/50"
                  >
                    <option value="inherit">继承全局</option>
                    <option value="on">开启</option>
                    <option value="off">关闭</option>
                  </select>
                </div>
              </div>
            </div>

            {/* API Config */}
            <div className="bg-surface rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <Key size={16} className="text-primary-400" />
                <h3 className="font-medium text-textPrimary text-sm">API 配置</h3>
              </div>
              <div className="text-sm space-y-1">
                <p>
                  <span className="text-textMuted">Base URL：</span>
                  <span className="text-textPrimary">{agent.api_base_url || '继承全局'}</span>
                </p>
                <p>
                  <span className="text-textMuted">API Key：</span>
                  <span className="text-textPrimary">{agent.has_api_key ? '已设置独立 Key' : '继承全局'}</span>
                </p>
                <p>
                  <span className="text-textMuted">API 额度成本：</span>
                  <span className="text-textPrimary">{agent.api_credit_cost}</span>
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="bg-surface rounded-xl border border-border p-4">
              <h3 className="font-medium text-textPrimary text-sm mb-3">操作</h3>
              <div className="flex flex-wrap gap-2">
                {/* Export */}
                <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-textSecondary hover:text-textPrimary hover:border-primary-500/30 transition-colors">
                  <Download size={14} /> 下载导出
                </button>
                <button onClick={handleCopyExport} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-textSecondary hover:text-textPrimary hover:border-primary-500/30 transition-colors">
                  {copied ? <Check size={14} className="text-mint-400" /> : <Copy size={14} />}
                  {copied ? '已复制' : '复制 JSON'}
                </button>

                {/* Import */}
                <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-textSecondary hover:text-textPrimary hover:border-primary-500/30 transition-colors cursor-pointer">
                  <Upload size={14} />
                  {importing ? '导入中...' : '导入灵魂'}
                  <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                </label>

                {/* Avatar */}
                <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-textSecondary hover:text-textPrimary hover:border-primary-500/30 transition-colors cursor-pointer">
                  <Image size={14} />
                  {uploadingAvatar ? '上传中...' : '更换头像'}
                  <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                </label>

                {/* Token */}
                <button onClick={handleGenerateToken} disabled={generatingToken} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-textSecondary hover:text-textPrimary hover:border-primary-500/30 transition-colors disabled:opacity-50">
                  <RefreshCw size={14} className={generatingToken ? 'animate-spin' : ''} />
                  {tokenMasked ? `Token: ${tokenMasked}` : '生成 API Token'}
                </button>
                {token && (
                  <div className="w-full flex items-center gap-2 mt-2 p-2 rounded-lg bg-amber-400/5 border border-amber-400/20">
                    <code className="text-xs text-amber-400 flex-1 break-all">{token}</code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(token); setToken(null) }}
                      className="text-xs text-amber-400 hover:text-amber-300"
                    >
                      复制（仅显示一次）
                    </button>
                  </div>
                )}

                {/* Delete */}
                <button onClick={() => setShowDelete(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-500/20 text-sm text-rose-400 hover:bg-rose-500/10 transition-colors">
                  <Trash2 size={14} /> 删除 AI
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'storage' && (
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <HardDrive size={16} className="text-primary-400" />
              <h3 className="font-medium text-textPrimary text-sm">存储管理</h3>
            </div>
            {storage ? (
              <>
                <div className="flex gap-4 mb-4 text-sm">
                  <div className="px-3 py-2 rounded-lg bg-canvas border border-border">
                    <span className="text-textMuted">总大小：</span>
                    <span className="text-textPrimary font-medium">{formatSize(storage.total_size)}</span>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-canvas border border-border">
                    <span className="text-textMuted">文件数：</span>
                    <span className="text-textPrimary font-medium">{storage.file_count}</span>
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
                  <p className="text-sm text-textMuted">暂无文件</p>
                )}
              </>
            ) : (
              <p className="text-sm text-textMuted">加载中...</p>
            )}
          </div>
        )}

        {activeTab === 'memories' && (
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Brain size={16} className="text-primary-400" />
              <h3 className="font-medium text-textPrimary text-sm">记忆（共 {memTotal} 条）</h3>
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
              <p className="text-sm text-textMuted">暂无记忆</p>
            )}
            {memTotal > 20 && (
              <div className="flex justify-center gap-2 mt-4">
                <button
                  onClick={() => loadMemories(memPage - 1)}
                  disabled={memPage <= 1}
                  className="px-3 py-1 text-xs rounded-lg border border-border text-textSecondary hover:text-textPrimary disabled:opacity-30"
                >
                  上一页
                </button>
                <span className="text-xs text-textMuted py-1">{memPage} / {Math.ceil(memTotal / 20)}</span>
                <button
                  onClick={() => loadMemories(memPage + 1)}
                  disabled={memPage >= Math.ceil(memTotal / 20)}
                  className="px-3 py-1 text-xs rounded-lg border border-border text-textSecondary hover:text-textPrimary disabled:opacity-30"
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'workspace' && (
          <div className="bg-surface rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Edit3 size={16} className="text-primary-400" />
              <h3 className="font-medium text-textPrimary text-sm">个人工作区</h3>
              <span className="text-xs text-textMuted ml-auto">AI 自主维护，用户只读</span>
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
                  {f === 'todo' ? 'TODO' : f === 'plan' ? 'PLAN' : 'JOURNAL'}
                </button>
              ))}
            </div>
            {/* Content */}
            <pre className="text-xs text-textSecondary whitespace-pre-wrap max-h-80 overflow-y-auto p-3 rounded-lg bg-canvas border border-border leading-relaxed font-mono min-h-[120px]">
              {workspace[wsActive] || `（${wsActive === 'todo' ? 'TODO 列表' : wsActive === 'plan' ? 'PLAN 规划' : 'JOURNAL 日志'} 为空）`}
            </pre>
          </div>
        )}
      </div>

      {/* Delete Confirm Modal */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-2xl border border-border p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-bold text-textPrimary mb-2">删除 AI</h3>
            <p className="text-sm text-textSecondary mb-4">
              此操作不可撤销。删除后将返还 <span className="text-mint-400 font-medium">{agent.api_credit_cost}</span> API 额度。
              请输入 AI 名称 <span className="text-rose-400 font-medium">"{agent.name}"</span> 确认：
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
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmName !== agent.name || deleting}
                className="flex-1 px-4 py-2 rounded-xl bg-rose-500 text-white text-sm font-medium hover:bg-rose-400 disabled:opacity-30 transition-colors"
              >
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
