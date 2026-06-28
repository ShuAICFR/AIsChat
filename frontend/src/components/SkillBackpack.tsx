import { useState, useEffect, useMemo } from 'react'
import { api } from '../api/client'
import { useT } from '../i18n/I18nContext'
import { STATE_LABELS, STATE_TAG_COLORS } from '../constants'
import {
  MessagesSquare, Folder, Brain, Users, Settings, Clock,
  ChevronDown, ChevronUp, Puzzle,
} from 'lucide-react'

// ─── 类型 ────────────────────────────────────────────

interface ToolInfo {
  name: string
  description: string
  admin_description: string
  trigger_condition: string
  states: string[]
  available_in_current_state?: boolean
}

interface SegmentInfo {
  name: string
  description: string
  admin_description: string
  trigger_conditions: string[]
  icon: string
  tool_count: number
  tools: ToolInfo[]
}

interface BackpackResponse {
  segments: SegmentInfo[]
  agent_state: string | null
  agent_thinking: boolean | null
}

// ─── 图标映射 ─────────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  'messages-square': MessagesSquare,
  'folder': Folder,
  'brain': Brain,
  'users': Users,
  'settings': Settings,
  'clock': Clock,
  'puzzle': Puzzle,
}

// ─── Props ────────────────────────────────────────────

interface Props {
  agentId?: number | null
  className?: string
}

// ─── 组件 ─────────────────────────────────────────────

export default function SkillBackpack({ agentId, className = '' }: Props) {
  const t = useT()
  const [data, setData] = useState<BackpackResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedSegment, setExpandedSegment] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const params = agentId ? `?agent_id=${agentId}` : ''
    api.get<BackpackResponse>(`/admin/tools/backpack${params}`)
      .then(r => { setData(r); setLoading(false) })
      .catch(() => setLoading(false))
  }, [agentId])

  const segments = useMemo(() => data?.segments ?? [], [data])

  if (loading) {
    return <div className={`text-center py-8 text-textSecondary text-sm ${className}`}>加载中...</div>
  }
  if (!data || segments.length === 0) {
    return <div className={`text-center py-8 text-red-500 text-sm ${className}`}>加载失败</div>
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 当前状态指示（仅当指定了 agent 时显示） */}
      {data.agent_state && (
        <div className="flex items-center gap-2 text-xs text-textSecondary">
          <span>{t('backpack.currentState')}:</span>
          <span className={`px-2 py-0.5 rounded ${STATE_TAG_COLORS[data.agent_state] || ''}`}>
            {STATE_LABELS[data.agent_state] || data.agent_state}
          </span>
          {data.agent_thinking !== null && (
            <span className="text-textMuted">
              · 深度推理: {data.agent_thinking ? '开' : '关'}
            </span>
          )}
        </div>
      )}

      {/* 段卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {segments.map(seg => {
          const Icon = ICON_MAP[seg.icon] || Puzzle
          const isExpanded = expandedSegment === seg.name
          const visibleTriggers = seg.trigger_conditions.slice(0, 2)
          const hiddenCount = seg.trigger_conditions.length - 2

          return (
            <div
              key={seg.name}
              className={`bg-surface rounded-xl border border-border transition-all duration-200 ${
                isExpanded ? 'ring-2 ring-primary-500/20 shadow-lg' : 'hover:border-primary-500/20 hover:shadow-sm'
              }`}
            >
              {/* 卡片头部 — 可点击展开 */}
              <button
                onClick={() => setExpandedSegment(isExpanded ? null : seg.name)}
                className="w-full p-4 text-left flex flex-col gap-2"
              >
                {/* 顶部：图标 + 名称 + 数量 */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary-500/10 flex items-center justify-center shrink-0">
                    <Icon size={18} className="text-primary-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-textPrimary">{seg.name}</h3>
                    <p className="text-[11px] text-textMuted">
                      {seg.tool_count} {t('backpack.toolCount')}
                    </p>
                  </div>
                  <div className="shrink-0 text-textMuted">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* 管理说明（一行截断） */}
                {seg.admin_description && (
                  <p className="text-[11px] text-textSecondary leading-relaxed line-clamp-2">
                    {seg.admin_description}
                  </p>
                )}

                {/* 触发条件标签（最多 2 个 + "+N"） */}
                {visibleTriggers.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {visibleTriggers.map(tc => (
                      <span
                        key={tc}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-primary-500/8 text-primary-600 dark:text-primary-400"
                        title={tc}
                      >
                        {tc.length > 12 ? tc.slice(0, 12) + '…' : tc}
                      </span>
                    ))}
                    {hiddenCount > 0 && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded bg-canvas text-textMuted"
                        title={seg.trigger_conditions.slice(2).join('、')}
                      >
                        +{hiddenCount}
                      </span>
                    )}
                  </div>
                )}
              </button>

              {/* 展开：工具列表 */}
              {isExpanded && (
                <div className="border-t border-border px-4 pb-4 pt-3 space-y-2 animate-in fade-in">
                  <p className="text-[11px] font-medium text-textPrimary">
                    {t('backpack.toolsInSkill')} ({seg.tool_count})
                  </p>
                  {seg.tools.map(tool => (
                    <div
                      key={tool.name}
                      className="bg-canvas/50 rounded-lg p-3 border border-border/50"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-medium text-textPrimary">
                          {tool.name}
                        </span>
                        {/* 可用性标注 */}
                        {tool.available_in_current_state !== undefined && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            tool.available_in_current_state
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                          }`}>
                            {tool.available_in_current_state
                              ? t('backpack.availableNow')
                              : t('backpack.unavailableNow')}
                          </span>
                        )}
                        {/* 状态标签 */}
                        {tool.states.map(s => (
                          <span
                            key={s}
                            className={`text-[10px] px-1.5 py-0.5 rounded ${STATE_TAG_COLORS[s] || ''}`}
                          >
                            {STATE_LABELS[s] || s}
                          </span>
                        ))}
                      </div>

                      {/* 工具管理说明 */}
                      {tool.admin_description && (
                        <p className="text-[11px] text-textSecondary leading-relaxed mt-1.5">
                          {tool.admin_description}
                        </p>
                      )}

                      {/* 工具触发条件 */}
                      {tool.trigger_condition && (
                        <div className="mt-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-500/8 text-primary-600 dark:text-primary-400">
                            {tool.trigger_condition.length > 30
                              ? tool.trigger_condition.slice(0, 30) + '…'
                              : tool.trigger_condition}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
