import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, useOutletContext } from 'react-router-dom'
import { api } from '../api/client'
import { Users, Bot, MessageCircle, Ticket, FileText, Activity, Terminal, Database, Globe, BookOpen, ScrollText, ArrowLeft, BarChart3, ChevronRight } from 'lucide-react'
import { MANUAL_URL } from '../constants'
import FederationTab from '../components/FederationTab'
import ConversationLogTab from '../components/ConversationLogTab'
import UsageDashboardTab from '../components/UsageDashboardTab'
import SystemMetricsTab from '../components/SystemMetricsTab'

type Tab = 'overview' | 'users' | 'agents' | 'groups' | 'codes' | 'logs' | 'opencli' | 'backup' | 'federation' | 'convlog' | 'usage' | 'metrics'
type TabCategory = '核心管理' | '系统配置' | '运维分析'

const tabs: { key: Tab; label: string; icon: React.ElementType; desc: string; category: TabCategory }[] = [
  { key: 'overview', label: '概览', icon: Activity, desc: '系统统计总览', category: '核心管理' },
  { key: 'users', label: '用户', icon: Users, desc: '用户列表与封禁管理', category: '核心管理' },
  { key: 'agents', label: 'AI 管理', icon: Bot, desc: 'AI 列表与自修改开关', category: '核心管理' },
  { key: 'groups', label: '群聊审查', icon: MessageCircle, desc: '群聊列表与解散操作', category: '核心管理' },
  { key: 'codes', label: '兑换码', icon: Ticket, desc: '生成与管理兑换码', category: '系统配置' },
  { key: 'opencli', label: 'OpenCLI', icon: Terminal, desc: '命令行白名单与全局设置', category: '系统配置' },
  { key: 'convlog', label: '对话日志', icon: ScrollText, desc: '全局日志设置与查看', category: '系统配置' },
  { key: 'backup', label: '备份', icon: Database, desc: '数据库与完整备份管理', category: '运维分析' },
  { key: 'logs', label: '审计', icon: FileText, desc: '系统操作日志记录', category: '运维分析' },
  { key: 'federation', label: '联邦', icon: Globe, desc: '联邦对等端与注册表', category: '运维分析' },
  { key: 'usage', label: '用量分析', icon: BarChart3, desc: '全站 Token 消耗统计', category: '运维分析' },
  { key: 'metrics', label: '系统监控', icon: Activity, desc: '实时性能指标与延迟趋势', category: '运维分析' },
]

const renderContent = (activeTab: Tab) => {
  switch (activeTab) {
    case 'overview': return <OverviewTab />
    case 'users': return <UsersTab />
    case 'agents': return <AgentsTab />
    case 'groups': return <GroupsTab />
    case 'codes': return <CodesTab />
    case 'opencli': return <OpenCLITab />
    case 'backup': return <BackupTab />
    case 'logs': return <LogsTab />
    case 'federation': return <FederationTab />
    case 'convlog': return <ConversationLogTab />
    case 'usage': return <UsageDashboardTab />
    case 'metrics': return <SystemMetricsTab />
    default: return <OverviewTab />
  }
}

export default function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab) || 'overview'
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  // 移动端：'list' 显示导航列表，'detail' 显示选中内容
  const [mobileView, setMobileView] = useState<'list' | 'detail'>(
    searchParams.get('tab') ? 'detail' : 'list'
  )
  const navigate = useNavigate()

  const switchTab = (tab: Tab) => {
    setActiveTab(tab)
    setSearchParams({ tab })
    setMobileView('detail')
  }

  const backToList = () => {
    setMobileView('list')
  }

  const currentTab = tabs.find(t => t.key === activeTab)

  return (
    <div className="h-full flex flex-col bg-canvas">
      {/* 头部 */}
      <div className="px-4 md:px-6 py-4 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-2 mb-1">
          {/* 返回按钮：移动端列表视图→我的；桌面端→我的；移动端详情→列表 */}
          {mobileView === 'detail' ? (
            <button
              onClick={backToList}
              className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
              title="返回列表"
            >
              <ArrowLeft size={20} />
            </button>
          ) : (
            <button
              onClick={() => navigate('/me')}
              className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
              title="返回我的"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <h1 className="text-xl font-bold text-textPrimary tracking-tight">
            {mobileView === 'detail' && currentTab ? currentTab.label : '管理员面板'}
          </h1>
        </div>
        {mobileView === 'list' && (
          <div className="flex items-center gap-1.5 flex-wrap text-sm text-textSecondary mt-0.5">
            <span>系统管理与监控 ·</span>
            <a
              href={MANUAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 transition-colors"
            >
              <BookOpen size={13} /> 使用手册
            </a>
          </div>
        )}
      </div>

      {/* 桌面端 Tab 导航 */}
      <div className="hidden md:flex gap-0 bg-surface border-b border-border px-4 md:px-6 overflow-x-auto shrink-0">
        {tabs.map((tab, i) => (
          <span key={tab.key} className="flex items-center">
            {i > 0 && tabs[i - 1].category !== tab.category && (
              <span className="w-px h-5 bg-border mx-1 shrink-0" />
            )}
            <button
              onClick={() => switchTab(tab.key)}
              className={`flex items-center gap-1.5 px-2.5 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-primary-400 text-primary-600 dark:text-primary-300'
                  : 'border-transparent text-textMuted hover:text-textSecondary'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          </span>
        ))}
      </div>

      {/* 移动端：导航列表视图（按分类分组） */}
      {mobileView === 'list' && (
        <div className="md:hidden flex-1 overflow-y-auto p-4 pb-[var(--safe-bottom)] bg-canvas space-y-4">
          {(['核心管理', '系统配置', '运维分析'] as TabCategory[]).map(cat => {
            const catTabs = tabs.filter(t => t.category === cat)
            return (
              <div key={cat}>
                <div className="text-xs font-semibold text-textMuted uppercase tracking-wider px-1 mb-1.5">{cat}</div>
                <div className="space-y-1">
                  {catTabs.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => switchTab(tab.key)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-elevated active:bg-border/50 transition-colors text-left"
                    >
                      <div className="w-9 h-9 rounded-lg bg-primary-500/10 flex items-center justify-center shrink-0">
                        <tab.icon size={18} className="text-primary-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-textPrimary">{tab.label}</div>
                        <div className="text-xs text-textMuted mt-0.5">{tab.desc}</div>
                      </div>
                      <ChevronRight size={16} className="text-textMuted shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 内容区（桌面端始终显示；移动端在详情视图显示） */}
      <div className={`flex-1 overflow-y-auto p-4 md:p-6 pb-[var(--safe-bottom)] md:pb-6 bg-canvas ${
        mobileView === 'list' ? 'hidden md:block' : ''
      }`}>
        {renderContent(activeTab)}
      </div>
    </div>
  )
}

function OverviewTab() {
  const [stats, setStats] = useState<any>(null)
  useEffect(() => {
    api.get('/admin/overview').then(setStats).catch(console.error)
  }, [])

  if (!stats) return <p className="text-textMuted">加载中...</p>

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard label="总用户数" value={stats.total_users} icon={Users} />
      <StatCard label="总 AI 数" value={stats.total_agents} icon={Bot} />
      <StatCard label="总群聊数" value={stats.total_groups} icon={MessageCircle} />
      <StatCard label="待处理申请" value={stats.pending_vector_requests} icon={Activity} />
    </div>
  )
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-5 hover:border-primary-500/20 transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary-500/10 flex items-center justify-center">
          <Icon size={20} className="text-primary-400" />
        </div>
        <div>
          <p className="text-2xl font-bold text-textPrimary">{value}</p>
          <p className="text-xs text-textSecondary">{label}</p>
        </div>
      </div>
    </div>
  )
}

function UsersTab() {
  const [data, setData] = useState<any>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    api.get(`/admin/users?page=${page}`).then(setData).catch(console.error)
  }, [page])

  if (!data) return <p className="text-textMuted">加载中...</p>

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-textPrimary">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-3 font-medium text-textSecondary">ID</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">用户名</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">角色</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">额度</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">状态</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((u: any) => (
              <tr key={u.id} className="border-b border-border/50">
                <td className="py-2 px-3">{u.id}</td>
                <td className="py-2 px-3 font-medium">{u.username}</td>
                <td className="py-2 px-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    u.role === 'admin' ? 'bg-primary-500/10 text-primary-600 dark:text-primary-300' : ''
                  }`}>
                    {u.role}
                  </span>
                </td>
                <td className="py-2 px-3">{u.ai_quota}</td>
                <td className="py-2 px-3">
                  <span className={`text-xs ${u.is_active ? 'text-mint-400' : 'text-rose-400'}`}>
                    {u.is_active ? '正常' : '已封禁'}
                  </span>
                </td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        await api.post(`/admin/users/${u.id}/ban`, {})
                        setPage(page) // 触发刷新
                      }}
                      className="text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300"
                    >
                      {u.is_active ? '封禁' : '解封'}
                    </button>
                    {u.role !== 'admin' ? (
                      <button
                        onClick={async () => {
                          if (!confirm(`确定将 ${u.username} 提升为管理员？`)) return
                          await api.put(`/admin/users/${u.id}/role`, { role: 'admin' })
                          setPage(page)
                        }}
                        className="text-xs text-mint-400 hover:text-mint-500 dark:hover:text-mint-300"
                      >
                        提升
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          if (!confirm(`确定撤销 ${u.username} 的管理员权限？`)) return
                          await api.put(`/admin/users/${u.id}/role`, { role: 'user' })
                          setPage(page)
                        }}
                        className="text-xs text-rose-400 hover:text-rose-500"
                      >
                        降级
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="text-sm px-3 py-1 border border-border bg-canvas rounded hover:bg-elevated disabled:opacity-40"
        >
          上一页
        </button>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={data.items.length < data.page_size}
          className="text-sm px-3 py-1 border border-border bg-canvas rounded hover:bg-elevated disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  )
}

function AgentsTab() {
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    api.get('/admin/agents').then(setData).catch(console.error)
  }, [])

  if (!data) return <p className="text-textMuted">加载中...</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-textPrimary">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-3 font-medium text-textSecondary">ID</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">名称</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">所属用户</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">状态</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">自修改</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">操作</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((a: any) => (
            <tr key={a.id} className="border-b border-border/50">
              <td className="py-2 px-3">{a.id}</td>
              <td className="py-2 px-3 font-medium">{a.name}</td>
              <td className="py-2 px-3">{a.owner_id}</td>
              <td className="py-2 px-3">{a.state}</td>
              <td className="py-2 px-3">
                <span className={a.is_ai_editable ? 'text-mint-400' : 'text-rose-400'}>
                  {a.is_ai_editable ? '是' : '否'}
                </span>
              </td>
              <td className="py-2 px-3">
                <button
                  onClick={async () => {
                    await api.put(`/admin/agents/${a.id}/editable`, { is_ai_editable: !a.is_ai_editable })
                    // 触发刷新
                    const newData = await api.get('/admin/agents')
                    setData(newData)
                  }}
                  className="text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300"
                >
                  {a.is_ai_editable ? '关闭自修改' : '开启自修改'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupsTab() {
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    api.get('/admin/groups').then(setData).catch(console.error)
  }, [])

  if (!data) return <p className="text-textMuted">加载中...</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-textPrimary">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-3 font-medium text-textSecondary">ID</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">名称</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">群主</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">向量加速</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">操作</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((g: any) => (
            <tr key={g.id} className="border-b border-border/50">
              <td className="py-2 px-3">{g.id}</td>
              <td className="py-2 px-3 font-medium">{g.name}</td>
              <td className="py-2 px-3">{g.owner_type}:{g.owner_id}</td>
              <td className="py-2 px-3">
                {g.is_vector_accelerated ? '已开启' : '未开启'}
              </td>
              <td className="py-2 px-3">
                <button
                  onClick={async () => {
                    if (confirm('确定解散此群聊？')) {
                      await api.delete(`/admin/groups/${g.id}`)
                      const newData = await api.get('/admin/groups')
                      setData(newData)
                    }
                  }}
                  className="text-xs text-rose-400 hover:text-rose-500"
                >
                  解散
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CodesTab() {
  const [codes, setCodes] = useState<any[]>([])
  const [quota, setQuota] = useState(3)
  const [days, setDays] = useState(30)
  const [codeType, setCodeType] = useState('ai_quota')
  const [generatedCode, setGeneratedCode] = useState('')
  const [generating, setGenerating] = useState(false)

  const CODE_TYPES: Record<string, string> = {
    ai_quota: 'AI创建额度',
    api_credit: '通用API额度',
    agent_bundle: 'AI包断额度',
    file_quota: '文件存储配额',
  }

  const loadCodes = async () => {
    try {
      const data = await api.get('/admin/redemption-codes')
      setCodes(data)
    } catch (err) { console.error(err) }
  }

  useEffect(() => { loadCodes() }, [])

  const handleGenerate = async () => {
    setGenerating(true)
    setGeneratedCode('')
    try {
      const data = await api.post('/admin/redemption-codes', {
        quota_amount: quota,
        expires_in_days: days,
        code_type: codeType,
      })
      setGeneratedCode(data.code)
      loadCodes()
    } catch (err: any) {
      console.error('生成兑换码失败:', err)
      alert(err?.message || err?.detail || '生成失败，请检查参数')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 生成兑换码 */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <h3 className="font-semibold text-textPrimary mb-3">生成兑换码</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs mb-1 text-textSecondary">类型</label>
            <select value={codeType} onChange={(e) => setCodeType(e.target.value)}
              className="px-2 py-1.5 border border-border bg-canvas rounded-xl text-sm text-textPrimary">
              {Object.entries(CODE_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1 text-textSecondary">额度</label>
            <input type="number" value={quota} onChange={(e) => setQuota(parseInt(e.target.value) || 0)}
              min={1} max={(codeType === 'file_size' || codeType === 'file_quota') ? 1024 : 100}
              className="w-24 px-2 py-1.5 border border-border bg-canvas rounded-xl text-sm text-textPrimary" />
          </div>
          <div>
            <label className="block text-xs mb-1 text-textSecondary">有效期（天）</label>
            <input type="number" value={days} onChange={(e) => setDays(parseInt(e.target.value) || 1)}
              min={1} max={365}
              className="w-20 px-2 py-1.5 border border-border bg-canvas rounded-xl text-sm text-textPrimary" />
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating || quota < 1 || days < 1}
            className="px-4 py-1.5 bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            {generating ? '生成中...' : '生成'}
          </button>
        </div>
        {generatedCode && (
          <div className="mt-3 p-3 bg-mint-400/10 border border-mint-400/20 rounded-xl">
            <p className="text-sm font-mono text-mint-400 break-all">{generatedCode}</p>
            <p className="text-xs text-mint-400 mt-1">请复制保管，此码仅显示一次</p>
          </div>
        )}
      </div>

      {/* 已生成的兑换码 */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <h3 className="font-semibold text-textPrimary mb-3">兑换码列表</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-textPrimary">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-textSecondary">兑换码</th>
                <th className="text-left py-2 px-3 font-medium text-textSecondary">类型</th>
                <th className="text-left py-2 px-3 font-medium text-textSecondary">额度</th>
                <th className="text-left py-2 px-3 font-medium text-textSecondary">到期时间</th>
                <th className="text-left py-2 px-3 font-medium text-textSecondary">状态</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c: any) => (
                <tr key={c.code} className="border-b border-border/50">
                  <td className="py-2 px-3 font-mono text-xs text-textPrimary">{c.code}</td>
                  <td className="py-2 px-3 text-xs text-textSecondary">{CODE_TYPES[c.code_type] || c.code_type || 'AI创建额度'}</td>
                  <td className="py-2 px-3 text-textPrimary">{c.quota_amount}{(c.code_type === 'file_size' || c.code_type === 'file_quota') ? ' MB' : ''}</td>
                  <td className="py-2 px-3 text-textSecondary">{c.expires_at ? new Date(c.expires_at).toLocaleDateString('zh-CN') : '-'}</td>
                  <td className="py-2 px-3">
                    {c.used_by ? (
                      <span className="text-xs text-textMuted">已使用 (uid:{c.used_by})</span>
                    ) : (
                      <span className="text-xs text-mint-400">可用</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ================================================================
   数据库备份/恢复
   ================================================================ */
function BackupTab() {
  const [downloading, setDownloading] = useState(false)
  const [downloadingFull, setDownloadingFull] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoringFull, setRestoringFull] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fullFileInputRef = useRef<HTMLInputElement>(null)

  const downloadFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── 仅数据库备份 ──
  const handleBackup = async () => {
    setDownloading(true)
    setError('')
    setMessage('')
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch('/api/admin/backup/download', {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '下载失败')
      }
      const blob = await res.blob()
      downloadFile(blob, `aischat_backup_${new Date().toISOString().slice(0, 10)}.sql`)
      setMessage('✓ 数据库备份下载成功')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDownloading(false)
    }
  }

  // ── 完整备份（数据库 + 文件）──
  const handleFullBackup = async () => {
    setDownloadingFull(true)
    setError('')
    setMessage('')
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch('/api/admin/backup/full/download', {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '下载失败')
      }
      const blob = await res.blob()
      downloadFile(blob, `aischat_full_${new Date().toISOString().slice(0, 10)}.tar.gz`)
      setMessage('✓ 完整备份下载成功（数据库 + 所有文件）')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDownloadingFull(false)
    }
  }

  // ── 仅数据库恢复 ──
  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!confirm('⚠️ 确定要恢复数据库？当前所有数据将被覆盖！')) return
    setRestoring(true)
    setError('')
    setMessage('')
    try {
      const token = localStorage.getItem('access_token')
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/admin/backup/restore', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '恢复失败')
      }
      setMessage('✓ 数据库已恢复，请刷新页面')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRestoring(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── 完整恢复（数据库 + 文件）──
  const handleFullRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!confirm('⚠️ 确定要完整恢复？当前数据库和所有文件将被覆盖！')) return
    setRestoringFull(true)
    setError('')
    setMessage('')
    try {
      const token = localStorage.getItem('access_token')
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/admin/backup/full/restore', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '恢复失败')
      }
      setMessage('✓ 完整备份已恢复：数据库 + 所有文件，请刷新页面')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRestoringFull(false)
      if (fullFileInputRef.current) fullFileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-5">
      {/* ========== 导出区 ========== */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <h3 className="font-semibold text-textPrimary mb-1">数据导出</h3>
        <p className="text-sm text-textMuted mb-5">两种备份格式，按需选择。</p>

        {/* 完整备份 */}
        <div className="bg-mint-400/5 border border-mint-400/20 rounded-xl p-4 mb-3">
          <div className="flex items-start gap-3">
            <Database size={20} className="text-mint-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-mint-400">完整备份（推荐）</h4>
              <p className="text-xs text-textSecondary mt-1">
                导出 <code className="text-[11px] bg-canvas px-1 py-0.5 rounded">.tar.gz</code> 文件，包含：<strong>数据库全部数据</strong> + <strong>/app/data/ 下所有文件</strong>（AI 文件、附件、头像等）。
                可用于完整迁移到新服务器。
              </p>
            </div>
            <button
              onClick={handleFullBackup}
              disabled={downloadingFull}
              className="shrink-0 px-4 py-2 bg-mint-400 text-white rounded-xl hover:bg-mint-500 disabled:opacity-40 text-sm font-medium transition-colors"
            >
              {downloadingFull ? '正在打包...' : '下载完整备份'}
            </button>
          </div>
        </div>

        {/* 仅数据库 */}
        <div className="bg-canvas border border-border rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Database size={20} className="text-textSecondary shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-textPrimary">仅数据库</h4>
              <p className="text-xs text-textSecondary mt-1">
                导出 <code className="text-[11px] bg-surface px-1 py-0.5 rounded">.sql</code> 文件，仅含数据表结构和数据。
                文件较小但<strong>不含上传的附件和 AI 文件</strong>。
              </p>
            </div>
            <button
              onClick={handleBackup}
              disabled={downloading}
              className="shrink-0 px-4 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-40 text-sm font-medium transition-colors"
            >
              {downloading ? '正在导出...' : '下载仅数据库'}
            </button>
          </div>
        </div>
      </div>

      {/* ========== 导入区 ========== */}
      <div className="bg-surface rounded-xl border border-rose-500/30 p-5">
        <h3 className="font-semibold text-textPrimary mb-1">数据恢复</h3>
        <p className="text-sm text-rose-400 mb-5">
          恢复将<strong>覆盖</strong>当前所有数据，请确认备份文件无误后再操作。
        </p>

        {/* 完整恢复 */}
        <div className="bg-rose-400/5 border border-rose-400/20 rounded-xl p-4 mb-3">
          <div className="flex items-start gap-3">
            <Database size={20} className="text-rose-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-rose-400">完整恢复</h4>
              <p className="text-xs text-textSecondary mt-1">
                上传 <code className="text-[11px] bg-canvas px-1 py-0.5 rounded">.tar.gz</code> 完整备份文件，还原数据库 + 所有文件。
              </p>
              <input
                ref={fullFileInputRef}
                type="file"
                accept=".tar.gz,.tgz"
                onChange={handleFullRestore}
                disabled={restoringFull}
                className="block mt-2 text-sm text-textPrimary file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:bg-elevated file:text-textPrimary hover:file:bg-border"
              />
              {restoringFull && <p className="text-sm text-textMuted mt-2">正在完整恢复...</p>}
            </div>
          </div>
        </div>

        {/* 仅数据库恢复 */}
        <div className="bg-canvas border border-border rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Database size={20} className="text-textSecondary shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold text-textPrimary">仅数据库恢复</h4>
              <p className="text-xs text-textSecondary mt-1">
                上传 <code className="text-[11px] bg-surface px-1 py-0.5 rounded">.sql</code> 文件，仅还原数据库。
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".sql"
                onChange={handleRestore}
                disabled={restoring}
                className="block mt-2 text-sm text-textPrimary file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:bg-elevated file:text-textPrimary hover:file:bg-border"
              />
              {restoring && <p className="text-sm text-textMuted mt-2">正在恢复...</p>}
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="text-sm text-mint-400 bg-mint-400/10 px-3 py-2 rounded-lg">{message}</div>
      )}
      {error && (
        <div className="text-sm text-rose-400 bg-rose-400/10 px-3 py-2 rounded-lg">{error}</div>
      )}
    </div>
  )
}

function LogsTab() {
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    api.get('/admin/logs?page_size=50').then(setData).catch(console.error)
  }, [])

  if (!data) return <p className="text-textMuted">加载中...</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-textPrimary">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-3 font-medium text-textSecondary">时间</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">类型</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">操作者</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">目标</th>
            <th className="text-left py-2 px-3 font-medium text-textSecondary">详情</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((log: any) => (
            <tr key={log.id} className="border-b border-border/50">
              <td className="py-2 px-3 text-xs">
                {log.created_at ? new Date(log.created_at).toLocaleString('zh-CN') : '-'}
              </td>
              <td className="py-2 px-3">
                <span className="text-xs px-2 py-0.5 rounded bg-elevated text-textPrimary">{log.log_type}</span>
              </td>
              <td className="py-2 px-3">{log.operator_type}:{log.operator_id}</td>
              <td className="py-2 px-3">{log.target_type}:{log.target_id}</td>
              <td className="py-2 px-3 text-xs text-textSecondary max-w-[200px] truncate">
                {JSON.stringify(log.details)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


// ============================================================
// OpenCLI 管理 Tab
// ============================================================

function OpenCLITab() {
  const [tab, setTab] = useState<'config' | 'agents' | 'commands' | 'logs'>('config')
  const subTabs = [
    { key: 'config' as const, label: '全局设置' },
    { key: 'agents' as const, label: 'AI 白名单' },
    { key: 'commands' as const, label: '命令白名单' },
    { key: 'logs' as const, label: '使用日志' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex gap-2 bg-canvas border border-border rounded-xl p-1 w-full">
        {subTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors font-medium ${
              tab === t.key
                ? 'bg-elevated text-textPrimary shadow-sm'
                : 'text-textMuted hover:text-textSecondary hover:bg-elevated'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'config' && <OpenCLIConfigSection />}
      {tab === 'agents' && <OpenCLIAgentsSection />}
      {tab === 'commands' && <OpenCLICommandsSection />}
      {tab === 'logs' && <OpenCLILogsSection />}
    </div>
  )
}

// ---- 全局设置 ----
function OpenCLIConfigSection() {
  const [config, setConfig] = useState<any>(null)
  const [enabled, setEnabled] = useState(false)
  const [rate, setRate] = useState(5)
  const [timeout, setTimeout_] = useState(30)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/admin/opencli/config').then((d) => {
      setConfig(d)
      setEnabled(d.global_enabled)
      setRate(d.default_rate_limit_per_minute)
      setTimeout_(d.timeout_seconds)
    }).catch(console.error)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.put('/admin/opencli/config', {
        global_enabled: enabled,
        default_rate_limit_per_minute: rate,
        timeout_seconds: timeout,
      })
      alert('配置已保存')
    } catch (err) { console.error(err) }
    setSaving(false)
  }

  if (!config) return <p className="text-textMuted">加载中...</p>

  return (
    <div className="bg-surface rounded-xl border border-border p-5 max-w-lg">
      <h3 className="font-semibold text-textPrimary mb-4">全局设置</h3>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-textPrimary">启用 OpenCLI</label>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`w-12 h-6 rounded-full transition-colors ${enabled ? 'bg-mint-400' : 'bg-border'}`}
          >
            <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-textSecondary">默认速率限制（次/分钟）</label>
          <input type="number" value={rate} onChange={(e) => setRate(parseInt(e.target.value))}
            className="w-24 px-2 py-1.5 border border-border bg-canvas rounded-xl text-sm text-textPrimary" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-textSecondary">超时时间（秒）</label>
          <input type="number" value={timeout} onChange={(e) => setTimeout_(parseInt(e.target.value))}
            className="w-24 px-2 py-1.5 border border-border bg-canvas rounded-xl text-sm text-textPrimary" />
        </div>
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-400 text-sm">
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )
}

// ---- AI 白名单 ----
function OpenCLIAgentsSection() {
  const [data, setData] = useState<any[]>([])
  useEffect(() => {
    api.get('/admin/opencli/agents').then(setData).catch(console.error)
  }, [])

  const toggleAgent = async (agentId: number, currentEnabled: boolean) => {
    await api.put(`/admin/opencli/agents/${agentId}`, { enabled: !currentEnabled })
    const newData = await api.get('/admin/opencli/agents')
    setData(newData)
  }

  if (!data.length) return <p className="text-textMuted">加载中...</p>

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <h3 className="font-semibold text-textPrimary mb-3">AI OpenCLI 白名单</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-textPrimary">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-3 font-medium text-textSecondary">ID</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">名称</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">所属用户</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">OpenCLI</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">速率限制</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a: any) => (
              <tr key={a.agent_id} className="border-b border-border/50">
                <td className="py-2 px-3">{a.agent_id}</td>
                <td className="py-2 px-3 font-medium">{a.agent_name}</td>
                <td className="py-2 px-3">{a.owner_id}</td>
                <td className="py-2 px-3">
                  <span className={a.enabled ? 'text-mint-400' : 'text-textMuted'}>
                    {a.enabled ? '已启用' : '未启用'}
                  </span>
                </td>
                <td className="py-2 px-3">{a.actual_rate_limit}/分钟</td>
                <td className="py-2 px-3">
                  <button
                    onClick={() => toggleAgent(a.agent_id, a.enabled)}
                    className="text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300"
                  >
                    {a.enabled ? '关闭' : '开启'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---- 命令白名单 ----
// ⚠️ 预设命令定义：与后端 POST /admin/opencli/commands/presets 保持一致
//    每个预设包含 pattern（命令名或正则）、is_regex、description（中文说明）
//    文件操作是进程内 Python 实现（不走 opencli），浏览器操作和外 CLI 桥接走 opencli
const OPENCLI_PRESETS = [
  // ── 文件操作（AI 在自己的沙箱目录里读写，进程内 Python 实现） ──
  { pattern: 'file_read',   is_regex: false, description: '读取文件 — 在自己文件空间里读取文本文件内容', category: '文件操作' },
  { pattern: 'file_write',  is_regex: false, description: '写入文件 — 创建或覆盖自己文件空间里的文件（自动建子目录）', category: '文件操作' },
  { pattern: 'file_list',   is_regex: false, description: '列出文件 — 浏览自己文件空间里的文件和子目录', category: '文件操作' },
  { pattern: 'file_delete', is_regex: false, description: '删除文件 — 删除自己文件空间里不需要的文件', category: '文件操作' },
  { pattern: 'file_info',   is_regex: false, description: '文件信息 — 查看文件大小、修改时间等元信息', category: '文件操作' },
  { pattern: 'create_dir',  is_regex: false, description: '创建目录 — 在自己文件空间里创建新文件夹', category: '文件操作' },
  // ── 浏览器自动化（操控已登录的 Chrome 浏览器） ──
  { pattern: 'browser',   is_regex: false, description: '浏览器操作 — AI 能打开网页、截图、点击、填表、抓取内容', category: '浏览器自动化' },
  { pattern: 'list',      is_regex: false, description: '列出命令 — AI 查看当前可用的所有 OpenCLI 命令', category: '浏览器自动化' },
  // ── 外部 CLI 桥接（将已有命令行工具接入 OpenCLI） ──
  { pattern: 'gh .*',     is_regex: true,  description: 'GitHub CLI — 浏览仓库、PR、Issue、搜索代码（需 gh CLI 已登录）', category: '外部 CLI 桥接' },
  { pattern: 'docker .*', is_regex: true,  description: 'Docker — 管理容器、镜像、查看运行状态', category: '外部 CLI 桥接' },
  { pattern: 'obsidian .*', is_regex: true, description: 'Obsidian — 读写笔记、搜索知识库', category: '外部 CLI 桥接' },
  { pattern: 'vercel .*', is_regex: true,  description: 'Vercel — 部署网站、查看项目、管理域名', category: '外部 CLI 桥接' },
  { pattern: 'tg .*',     is_regex: true,  description: 'Telegram CLI — 收发消息、管理频道', category: '外部 CLI 桥接' },
  { pattern: 'discord .*', is_regex: true, description: 'Discord CLI — 发消息、管理服务器', category: '外部 CLI 桥接' },
  { pattern: 'wx .*',     is_regex: true,  description: '微信 CLI — 下载公众号文章、管理消息', category: '外部 CLI 桥接' },
]

function OpenCLICommandsSection() {
  const [data, setData] = useState<any[]>([])
  const [pattern, setPattern] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [desc, setDesc] = useState('')
  const [addingPresets, setAddingPresets] = useState(false)

  const load = async () => {
    const d = await api.get('/admin/opencli/commands')
    setData(Array.isArray(d) ? d : d.items || [])
  }

  useEffect(() => { load() }, [])

  // 检查某个预设是否已在白名单中（按 pattern + is_regex 匹配）
  const isPresetAdded = (pattern: string, isRegex: boolean) => {
    return data.some((c: any) => c.pattern === pattern && c.is_regex === isRegex)
  }

  // 获取已添加预设的当前状态
  const getPresetStatus = (pattern: string, isRegex: boolean) => {
    const found = data.find((c: any) => c.pattern === pattern && c.is_regex === isRegex)
    return found ? (found.enabled ? '已启用' : '已禁用') : '未添加'
  }

  const handleAdd = async () => {
    if (!pattern.trim()) return
    await api.post('/admin/opencli/commands', { pattern: pattern.trim(), is_regex: isRegex, description: desc || null })
    setPattern(''); setIsRegex(false); setDesc('')
    load()
  }

  // 一键添加所有预设（调用后端批量 API）
  const handleAddAllPresets = async () => {
    setAddingPresets(true)
    try {
      const result = await api.post('/admin/opencli/commands/presets')
      alert(result.message || '预设命令添加完成')
      load()
    } catch (err: any) {
      alert(err.message || '添加预设失败')
    }
    setAddingPresets(false)
  }

  // 添加单个预设
  const handleAddPreset = async (presetPattern: string, presetIsRegex: boolean, presetDesc: string) => {
    await api.post('/admin/opencli/commands', {
      pattern: presetPattern,
      is_regex: presetIsRegex,
      description: presetDesc,
    })
    load()
  }

  const handleToggle = async (id: number, enabled: boolean) => {
    await api.put(`/admin/opencli/commands/${id}/toggle?enabled=${!enabled}`)
    load()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除此命令白名单？')) return
    await api.delete(`/admin/opencli/commands/${id}`)
    load()
  }

  // 按类别分组预设
  const presetCategories = [...new Set(OPENCLI_PRESETS.map(p => p.category))]

  return (
    <div className="space-y-4">
      {/* ── 预设命令快速添加（新手友好） ── */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-textPrimary">预设命令（新手一键添加）</h3>
            <p className="text-xs text-textMuted mt-1">
              以下是 AI 最常用的命令，点击「添加」即可加入白名单。已添加的命令不会重复添加。
            </p>
          </div>
          <button
            onClick={handleAddAllPresets}
            disabled={addingPresets}
            className="px-4 py-2 bg-mint-500 text-white rounded-xl hover:bg-mint-400 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            {addingPresets ? '添加中...' : '一键添加全部预设'}
          </button>
        </div>

        {presetCategories.map(cat => {
          const catPresets = OPENCLI_PRESETS.filter(p => p.category === cat)
          const allAdded = catPresets.every(p => isPresetAdded(p.pattern, p.is_regex))
          return (
            <div key={cat} className="mb-3 last:mb-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-textSecondary uppercase tracking-wider">{cat}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${allAdded ? 'bg-mint-400/10 text-mint-400' : 'bg-amber-400/10 text-amber-400'}`}>
                  {allAdded ? '✓ 已全部添加' : `${catPresets.filter(p => isPresetAdded(p.pattern, p.is_regex)).length}/${catPresets.length}`}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {catPresets.map(p => {
                  const added = isPresetAdded(p.pattern, p.is_regex)
                  const status = getPresetStatus(p.pattern, p.is_regex)
                  return (
                    <div
                      key={`${p.pattern}-${p.is_regex}`}
                      className={`rounded-lg border p-3 text-sm transition-colors ${
                        added
                          ? 'border-mint-400/30 bg-mint-400/5'
                          : 'border-border bg-canvas hover:border-primary-400/30'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <code className="text-xs font-mono text-textPrimary break-all">{p.pattern}</code>
                          <span className="text-xs text-textMuted ml-1.5">{p.is_regex ? '(正则)' : '(精确)'}</span>
                          <p className="text-xs text-textSecondary mt-1 leading-relaxed">{p.description}</p>
                        </div>
                        <button
                          onClick={() => !added && handleAddPreset(p.pattern, p.is_regex, p.description)}
                          disabled={added}
                          className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                            added
                              ? 'bg-mint-400/10 text-mint-400 cursor-default'
                              : 'bg-primary-500 text-white hover:bg-primary-400'
                          }`}
                        >
                          {added ? status : '＋ 添加'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── 手动添加表单 ── */}
      <div className="bg-surface rounded-xl border border-border p-5 max-w-lg">
        <h3 className="font-semibold mb-3 text-textPrimary">手动添加命令</h3>
        <p className="text-xs text-textMuted mb-3">
          如需添加不在预设中的命令（如其他网站接入），请手动输入。
          <br />
          <strong>精确模式</strong>：只匹配完全相同的命令名（如 <code className="text-xs bg-canvas px-1 rounded">web read</code>）
          <br />
          <strong>正则模式</strong>：匹配一类命令（如 <code className="text-xs bg-canvas px-1 rounded">bilibili .*</code> 匹配所有 B 站子命令）
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs mb-1 text-textSecondary">命令/正则</label>
            <input value={pattern} onChange={(e) => setPattern(e.target.value)}
              className="w-40 px-2 py-1.5 border border-border bg-canvas rounded-xl text-sm text-textPrimary"
              placeholder="bilibili 或 gh .*" />
          </div>
          <div className="flex items-center gap-1.5 mb-1">
            <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)}
              className="rounded" />
            <span className="text-xs text-textSecondary">正则</span>
          </div>
          <div>
            <label className="block text-xs mb-1 text-textSecondary">描述</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)}
              className="w-32 px-2 py-1.5 border border-border bg-canvas rounded-xl text-sm text-textPrimary"
              placeholder="可选" />
          </div>
          <button onClick={handleAdd}
            className="px-3 py-1.5 bg-primary-500 text-white rounded-xl hover:bg-primary-400 text-sm">
            添加
          </button>
        </div>
      </div>

      {/* ── 白名单列表 ── */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <h3 className="font-semibold mb-3 text-textPrimary">命令白名单列表</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-textPrimary">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-textSecondary">模式</th>
                <th className="text-left py-2 px-3 font-medium text-textSecondary">类型</th>
                <th className="text-left py-2 px-3 font-medium text-textSecondary">描述</th>
                <th className="text-left py-2 px-3 font-medium text-textSecondary">状态</th>
                <th className="text-left py-2 px-3 font-medium text-textSecondary">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c: any) => (
                <tr key={c.id} className="border-b border-border/50">
                  <td className="py-2 px-3 font-mono text-xs text-textPrimary">{c.pattern}</td>
                  <td className="py-2 px-3 text-xs text-textSecondary">{c.is_regex ? '正则' : '精确'}</td>
                  <td className="py-2 px-3 text-xs text-textSecondary">{c.description || '-'}</td>
                  <td className="py-2 px-3">
                    <span className={c.enabled ? 'text-mint-400 text-xs' : 'text-textMuted text-xs'}>
                      {c.enabled ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className="py-2 px-3 flex gap-2">
                    <button onClick={() => handleToggle(c.id, c.enabled)}
                      className="text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300">
                      {c.enabled ? '禁用' : '启用'}
                    </button>
                    <button onClick={() => handleDelete(c.id)}
                      className="text-xs text-rose-400 hover:text-rose-500">
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-textMuted">暂无命令白名单 — 点击上方预设卡片快速添加</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---- 使用日志 ----
function OpenCLILogsSection() {
  const [data, setData] = useState<any>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    api.get(`/admin/opencli/logs?page=${page}&page_size=30`).then(setData).catch(console.error)
  }, [page])

  if (!data) return <p className="text-textMuted">加载中...</p>

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <h3 className="font-semibold text-textPrimary mb-3">使用日志</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-textPrimary">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-3 font-medium text-textSecondary">时间</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">AI</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">命令</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">退出码</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">耗时</th>
              <th className="text-left py-2 px-3 font-medium text-textSecondary">输出预览</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((log: any) => (
              <tr key={log.id} className="border-b border-border/50">
                <td className="py-2 px-3 text-xs text-textSecondary">
                  {log.executed_at ? new Date(log.executed_at).toLocaleString('zh-CN') : '-'}
                </td>
                <td className="py-2 px-3 text-xs text-textPrimary">AI #{log.agent_id}</td>
                <td className="py-2 px-3 font-mono text-xs text-textPrimary">
                  {log.command}{log.args ? ` ${log.args}` : ''}
                </td>
                <td className="py-2 px-3">
                  <span className={log.exit_code === 0 ? 'text-mint-400 text-xs' : 'text-rose-400 text-xs'}>
                    {log.exit_code}
                  </span>
                </td>
                <td className="py-2 px-3 text-xs text-textSecondary">{log.duration_ms}ms</td>
                <td className="py-2 px-3 text-xs text-textSecondary max-w-[250px] truncate">
                  {log.stdout_truncated || log.stderr_truncated || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
          className="text-sm px-3 py-1 border border-border bg-canvas rounded hover:bg-elevated disabled:opacity-40">
          上一页
        </button>
        <button onClick={() => setPage(p => p + 1)} disabled={data.items.length < data.page_size}
          className="text-sm px-3 py-1 border border-border bg-canvas rounded hover:bg-elevated disabled:opacity-40">
          下一页
        </button>
      </div>
    </div>
  )
}
