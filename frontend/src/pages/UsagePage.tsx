import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from 'recharts'
import { ArrowLeft, Loader2, BarChart3 } from 'lucide-react'

interface DailyPoint {
  date: string
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
  reasoning_tokens: number
  cached_tokens: number
  request_count: number
}

interface AgentSummary {
  agent_id: number
  agent_name: string
  model: string | null
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
  reasoning_tokens: number
  cached_tokens: number
  total_calls: number
}

export default function UsagePage() {
  const [searchParams] = useSearchParams()
  const [days, setDays] = useState(30)
  const [overview, setOverview] = useState<AgentSummary[]>([])
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)
  const [dailyData, setDailyData] = useState<DailyPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [chartLoading, setChartLoading] = useState(false)
  const [isDark, setIsDark] = useState(false)

  // 监听日夜模式
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'))
    check()
    const obs = new MutationObserver(check)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  // 加载概览
  useEffect(() => {
    setLoading(true)
    api.get<AgentSummary[]>(`/conversation-log/usage/overview?days=${days}`)
      .then(r => {
        const data = Array.isArray(r) ? r : []
        setOverview(data)
        if (data.length > 0 && !selectedAgent) {
          setSelectedAgent(data[0].agent_id)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [days])

  // 加载每日分布
  useEffect(() => {
    if (!selectedAgent) return
    setChartLoading(true)
    api.get<DailyPoint[]>(`/conversation-log/usage/agents/${selectedAgent}/daily?days=${days}`)
      .then(r => setDailyData(Array.isArray(r) ? r : []))
      .catch(() => {})
      .finally(() => setChartLoading(false))
  }, [selectedAgent, days])

  // 汇总
  const totalTokens = overview.reduce((s, a) => s + (a.total_tokens || 0), 0)
  const totalCalls = overview.reduce((s, a) => s + (a.total_calls || 0), 0)
  const totalReasoning = overview.reduce((s, a) => s + (a.reasoning_tokens || 0), 0)
  const totalCached = overview.reduce((s, a) => s + (a.cached_tokens || 0), 0)
  const cacheRate = totalTokens + totalCached > 0 ? Math.round(totalCached / (totalTokens + totalCached) * 100) : 0

  // 图表颜色
  const colors = isDark ? {
    prompt: '#A78BFA',
    completion: '#34D399',
    reasoning: '#FBBF24',
    cached: '#22D3EE',
    grid: '#374151',
    text: '#9CA3AF',
  } : {
    prompt: '#7C3AED',
    completion: '#10B981',
    reasoning: '#F59E0B',
    cached: '#06B6D4',
    grid: '#E5E7EB',
    text: '#6B7280',
  }

  // 格式化
  const fmtNum = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString()
  const selectedInfo = overview.find(a => a.agent_id === selectedAgent)

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-5 pb-24 md:pb-6">
      {/* 头部 */}
      <div className="flex items-center gap-3">
        <button onClick={() => history.back()} className="p-1.5 rounded-lg hover:bg-elevated text-textMuted transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-lg font-semibold text-textPrimary flex items-center gap-2">
          <BarChart3 size={20} className="text-primary-400" /> API 用量详情
        </h2>
      </div>

      {/* 日期选择 */}
      <div className="flex gap-2">
        {[7, 30, 60, 90].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-colors ${
              days === d
                ? 'bg-primary-500/15 text-primary-600 dark:text-primary-300 border border-primary-400/30'
                : 'bg-surface border border-border text-textSecondary hover:bg-elevated'
            }`}
          >
            {d} 天
          </button>
        ))}
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '总 Token', value: fmtNum(totalTokens), icon: '📊' },
          { label: '调用次数', value: totalCalls, icon: '📞' },
          { label: '缓存命中率', value: `${cacheRate}%`, icon: '💾' },
          { label: '思考 Token', value: fmtNum(totalReasoning), icon: '🧠' },
        ].map(item => (
          <div key={item.label} className="bg-surface rounded-xl border border-border p-4 text-center">
            <div className="text-xl mb-1">{item.icon}</div>
            <div className="text-lg font-semibold text-textPrimary">{item.value}</div>
            <div className="text-[10px] text-textMuted">{item.label}</div>
          </div>
        ))}
      </div>

      {/* AI 选择 + 图表 */}
      <div className="bg-surface rounded-2xl border border-border p-5">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin" size={24} /></div>
        ) : overview.length === 0 ? (
          <div className="text-center py-12 text-textMuted text-sm">
            暂无用量数据。<br />
            <span className="text-xs">AI 对话后数据会出现在这里。</span>
          </div>
        ) : (
          <>
            {/* AI 选择器 */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs text-textMuted shrink-0">查看 AI：</span>
              <select
                value={selectedAgent || ''}
                onChange={e => setSelectedAgent(e.target.value ? parseInt(e.target.value) : null)}
                className="px-3 py-1.5 rounded-xl border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              >
                <option value="">全部 AI</option>
                {overview.map(a => (
                  <option key={a.agent_id} value={a.agent_id}>{a.agent_name}</option>
                ))}
              </select>
              {selectedInfo && (
                <span className="text-xs text-textMuted ml-auto">
                  模型: {selectedInfo.model || '默认'} · {selectedInfo.total_calls} 次调用
                </span>
              )}
            </div>

            {/* 图表 */}
            {chartLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="animate-spin" size={20} /></div>
            ) : dailyData.length === 0 ? (
              <div className="text-center py-12 text-textMuted text-sm">该 AI 暂无每日用量数据</div>
            ) : (
              <div className="h-72 md:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyData} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: colors.text }}
                      tickFormatter={v => v.slice(5)} // MM-DD
                    />
                    <YAxis tick={{ fontSize: 11, fill: colors.text }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
                        border: `1px solid ${colors.grid}`,
                        borderRadius: '12px',
                        fontSize: '12px',
                        color: isDark ? '#F9FAFB' : '#111827',
                      }}
                      formatter={(value: number, name: string) => [fmtNum(value),
                        name === 'prompt_tokens' ? 'Prompt' :
                        name === 'completion_tokens' ? 'Completion' :
                        name === 'reasoning_tokens' ? '思考' : '缓存'
                      ]}
                    />
                    <Legend
                      formatter={(v: string) =>
                        v === 'prompt_tokens' ? 'Prompt' :
                        v === 'completion_tokens' ? 'Completion' :
                        v === 'reasoning_tokens' ? '思考' : '缓存'
                      }
                    />
                    <Bar dataKey="prompt_tokens" stackId="a" fill={colors.prompt} name="prompt_tokens" />
                    <Bar dataKey="completion_tokens" stackId="a" fill={colors.completion} name="completion_tokens" />
                    <Bar dataKey="reasoning_tokens" stackId="a" fill={colors.reasoning} name="reasoning_tokens" />
                    <Bar dataKey="cached_tokens" stackId="a" fill={colors.cached} name="cached_tokens" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </div>

      {/* AI 明细表 */}
      {overview.length > 0 && (
        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-textPrimary">AI 用量明细</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-canvas">
                <tr className="text-textMuted">
                  <th className="text-left py-2 px-4 font-medium">AI</th>
                  <th className="text-left py-2 px-4 font-medium hidden md:table-cell">模型</th>
                  <th className="text-right py-2 px-4 font-medium">总 Token</th>
                  <th className="text-right py-2 px-4 font-medium hidden md:table-cell">Prompt</th>
                  <th className="text-right py-2 px-4 font-medium hidden md:table-cell">Completion</th>
                  <th className="text-right py-2 px-4 font-medium hidden md:table-cell">思考</th>
                  <th className="text-right py-2 px-4 font-medium">调用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {overview.map(a => (
                  <tr
                    key={a.agent_id}
                    className={`hover:bg-elevated cursor-pointer transition-colors ${selectedAgent === a.agent_id ? 'bg-primary-500/5' : ''}`}
                    onClick={() => setSelectedAgent(a.agent_id)}
                  >
                    <td className="py-2.5 px-4 text-textPrimary font-medium">{a.agent_name}</td>
                    <td className="py-2.5 px-4 text-textMuted hidden md:table-cell">{a.model || '-'}</td>
                    <td className="py-2.5 px-4 text-right text-textPrimary font-mono">{fmtNum(a.total_tokens)}</td>
                    <td className="py-2.5 px-4 text-right text-textMuted font-mono hidden md:table-cell">{fmtNum(a.prompt_tokens)}</td>
                    <td className="py-2.5 px-4 text-right text-textMuted font-mono hidden md:table-cell">{fmtNum(a.completion_tokens)}</td>
                    <td className="py-2.5 px-4 text-right text-textMuted font-mono hidden md:table-cell">{fmtNum(a.reasoning_tokens)}</td>
                    <td className="py-2.5 px-4 text-right text-textMuted">{a.total_calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
