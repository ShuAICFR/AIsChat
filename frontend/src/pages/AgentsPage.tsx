import { useState, useEffect } from 'react'
import { api, ApiError } from '../api/client'
import { Bot, Plus, Edit3, History, Power, X, RotateCcw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

interface Agent {
  id: number
  name: string
  state: string
  is_ai_editable: boolean
  // 原始设定
  original_system_prompt: string | null
  original_temperature: number
  original_top_p: number
  original_presence_penalty: number
  original_frequency_penalty: number
  // 当前设定（AI 可能已修改）
  current_system_prompt: string | null
  current_temperature: number
  current_top_p: number
  current_presence_penalty: number
  current_frequency_penalty: number
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

const stateColors: Record<string, string> = {
  active: 'bg-mint-400/15 text-mint-400 border-mint-400/30',
  dnd: 'bg-rose-400/15 text-rose-400 border-rose-400/30',
  offline: 'bg-[#6B7280]/15 text-textSecondary border-[#6B7280]/30',
  blocked: 'bg-accent-400/15 text-accent-400 border-accent-400/30',
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [editAgent, setEditAgent] = useState<Agent | null>(null)
  const [historyAgent, setHistoryAgent] = useState<Agent | null>(null)
  const [stateAgent, setStateAgent] = useState<Agent | null>(null)
  const { refreshUser } = useAuth()

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

  return (
    <div className="h-full overflow-y-auto p-6 bg-canvas">
      <div className="max-w-4xl mx-auto">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-textPrimary tracking-tight">我的 AI</h1>
            <p className="text-sm text-textSecondary mt-1">
              创建和管理你的 AI 角色
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-500 text-white rounded-xl hover:bg-primary-400 text-sm font-medium transition-all shadow-lg shadow-primary-500/20"
          >
            <Plus size={16} />
            创建 AI
          </button>
        </div>

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
                  className="bg-surface border border-border rounded-xl p-5 hover:border-primary-500/30 transition-all duration-200"
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

                  <div className="flex items-center gap-2 text-xs text-textMuted mb-1">
                    <span>
                      Temp: {agent.current_temperature}
                      {hasModified && agent.original_temperature !== agent.current_temperature && (
                        <span className="text-accent-400 ml-0.5">({agent.original_temperature})</span>
                      )}
                    </span>
                    {agent.is_ai_editable && (
                      <span className="text-mint-400">可自修改</span>
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const hasModified =
    agent.current_system_prompt !== agent.original_system_prompt ||
    agent.current_temperature !== agent.original_temperature

  const handleSave = async () => {
    setLoading(true)
    setError('')
    try {
      await api.put(`/agents/${agent.id}/config`, {
        system_prompt: systemPrompt || null,
        temperature,
        top_p: topP,
        presence_penalty: presencePenalty,
        frequency_penalty: frequencyPenalty,
      })
      onUpdated()
    } catch (err: any) {
      setError(err.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto shadow-2xl shadow-black/30" onClick={(e) => e.stopPropagation()}>
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
            <h3 className="text-sm font-semibold text-primary-400 mb-3 flex items-center gap-1">
              ✏️ 当前设定{hasModified ? '（AI 已修改）' : ''}
            </h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-textMuted">System Prompt</label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-1.5 rounded-lg border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none mt-0.5"
                />
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
            </div>
          </div>
        </div>

        {error && <div className="text-sm text-rose-400 mb-3">{error}</div>}

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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-xl mx-4 max-h-[80vh] overflow-y-auto shadow-2xl shadow-black/30" onClick={(e) => e.stopPropagation()}>
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl shadow-black/30" onClick={(e) => e.stopPropagation()}>
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
function CreateAgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [temperature, setTemperature] = useState(0.8)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post('/agents', {
        name: name.trim(),
        system_prompt: systemPrompt || null,
        temperature,
      })
      onCreated()
    } catch (err: any) {
      setError(err.message || '创建失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl shadow-black/30" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-4 text-textPrimary">创建新 AI</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1.5 text-textSecondary">名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              placeholder="给 AI 起个名字"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 text-textSecondary">系统提示词</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={3}
              className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none"
              placeholder="描述 AI 的性格和行为..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 text-textSecondary">
              Temperature: {temperature}
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-primary-500"
            />
          </div>
        </div>

        {error && <div className="text-sm text-rose-400 mt-3">{error}</div>}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-elevated text-textSecondary transition-colors font-medium">
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="flex-1 py-2.5 text-sm bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-30 font-medium transition-all shadow-lg shadow-primary-500/20"
          >
            {loading ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
