import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { Users, Bot, MessageCircle, Ticket, FileText, Activity, Terminal } from 'lucide-react'

type Tab = 'overview' | 'users' | 'agents' | 'groups' | 'codes' | 'logs' | 'opencli'

const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: '概览', icon: Activity },
  { key: 'users', label: '用户', icon: Users },
  { key: 'agents', label: 'AI 管理', icon: Bot },
  { key: 'groups', label: '群聊审查', icon: MessageCircle },
  { key: 'codes', label: '兑换码', icon: Ticket },
  { key: 'opencli', label: 'OpenCLI', icon: Terminal },
  { key: 'logs', label: '日志', icon: FileText },
]

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">管理员面板</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">系统管理与监控</p>
      </div>

      {/* Tab 导航 */}
      <div className="flex gap-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'agents' && <AgentsTab />}
        {activeTab === 'groups' && <GroupsTab />}
        {activeTab === 'codes' && <CodesTab />}
        {activeTab === 'opencli' && <OpenCLITab />}
        {activeTab === 'logs' && <LogsTab />}
      </div>
    </div>
  )
}

function OverviewTab() {
  const [stats, setStats] = useState<any>(null)
  useEffect(() => {
    api.get('/admin/overview').then(setStats).catch(console.error)
  }, [])

  if (!stats) return <p className="text-gray-400">加载中...</p>

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
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
          <Icon size={20} className="text-primary-500" />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
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

  if (!data) return <p className="text-gray-400">加载中...</p>

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-2 px-3 font-medium text-gray-500">ID</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">用户名</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">角色</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">额度</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">状态</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((u: any) => (
              <tr key={u.id} className="border-b border-gray-100 dark:border-gray-700/50">
                <td className="py-2 px-3">{u.id}</td>
                <td className="py-2 px-3 font-medium">{u.username}</td>
                <td className="py-2 px-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    u.role === 'admin' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : ''
                  }`}>
                    {u.role}
                  </span>
                </td>
                <td className="py-2 px-3">{u.ai_quota}</td>
                <td className="py-2 px-3">
                  <span className={`text-xs ${u.is_active ? 'text-green-500' : 'text-red-500'}`}>
                    {u.is_active ? '正常' : '已封禁'}
                  </span>
                </td>
                <td className="py-2 px-3">
                  <button
                    onClick={async () => {
                      await api.post(`/admin/users/${u.id}/ban`, {})
                      setPage(page) // 触发刷新
                    }}
                    className="text-xs text-primary-500 hover:text-primary-600"
                  >
                    {u.is_active ? '封禁' : '解封'}
                  </button>
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
          className="text-sm px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
        >
          上一页
        </button>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={data.items.length < data.page_size}
          className="text-sm px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
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

  if (!data) return <p className="text-gray-400">加载中...</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="text-left py-2 px-3 font-medium text-gray-500">ID</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">名称</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">所属用户</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">状态</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">自修改</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((a: any) => (
            <tr key={a.id} className="border-b border-gray-100 dark:border-gray-700/50">
              <td className="py-2 px-3">{a.id}</td>
              <td className="py-2 px-3 font-medium">{a.name}</td>
              <td className="py-2 px-3">{a.owner_id}</td>
              <td className="py-2 px-3">{a.state}</td>
              <td className="py-2 px-3">
                <span className={a.is_ai_editable ? 'text-green-500' : 'text-red-500'}>
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
                  className="text-xs text-primary-500 hover:text-primary-600"
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

  if (!data) return <p className="text-gray-400">加载中...</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="text-left py-2 px-3 font-medium text-gray-500">ID</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">名称</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">群主</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">向量加速</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((g: any) => (
            <tr key={g.id} className="border-b border-gray-100 dark:border-gray-700/50">
              <td className="py-2 px-3">{g.id}</td>
              <td className="py-2 px-3 font-medium">{g.name}</td>
              <td className="py-2 px-3">{g.owner_type}:{g.owner_id}</td>
              <td className="py-2 px-3">
                {g.is_vector_accelerated ? '⚡ 已开启' : '未开启'}
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
                  className="text-xs text-red-500 hover:text-red-600"
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
  const [generatedCode, setGeneratedCode] = useState('')

  const loadCodes = async () => {
    try {
      const data = await api.get('/admin/redemption-codes')
      setCodes(data)
    } catch (err) { console.error(err) }
  }

  useEffect(() => { loadCodes() }, [])

  const handleGenerate = async () => {
    try {
      const data = await api.post('/admin/redemption-codes', {
        quota_amount: quota,
        expires_in_days: days,
      })
      setGeneratedCode(data.code)
      loadCodes()
    } catch (err) { console.error(err) }
  }

  return (
    <div className="space-y-6">
      {/* 生成兑换码 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="font-semibold mb-3">生成兑换码</h3>
        <div className="flex items-end gap-4">
          <div>
            <label className="block text-xs mb-1">额度</label>
            <input type="number" value={quota} onChange={(e) => setQuota(parseInt(e.target.value))}
              className="w-20 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm" />
          </div>
          <div>
            <label className="block text-xs mb-1">有效期（天）</label>
            <input type="number" value={days} onChange={(e) => setDays(parseInt(e.target.value))}
              className="w-20 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm" />
          </div>
          <button onClick={handleGenerate}
            className="px-4 py-1.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm">
            生成
          </button>
        </div>
        {generatedCode && (
          <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <p className="text-sm font-mono text-green-700 dark:text-green-400">{generatedCode}</p>
            <p className="text-xs text-green-500 mt-1">请复制保管，此码仅显示一次</p>
          </div>
        )}
      </div>

      {/* 已生成的兑换码 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="font-semibold mb-3">兑换码列表</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-3 font-medium text-gray-500">兑换码</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">额度</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">到期时间</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">状态</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c: any) => (
                <tr key={c.code} className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 px-3 font-mono text-xs">{c.code}</td>
                  <td className="py-2 px-3">{c.quota_amount}</td>
                  <td className="py-2 px-3">{c.expires_at ? new Date(c.expires_at).toLocaleDateString('zh-CN') : '-'}</td>
                  <td className="py-2 px-3">
                    {c.used_by ? (
                      <span className="text-xs text-gray-400">已使用 (uid:{c.used_by})</span>
                    ) : (
                      <span className="text-xs text-green-500">可用</span>
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

function LogsTab() {
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    api.get('/admin/logs?page_size=50').then(setData).catch(console.error)
  }, [])

  if (!data) return <p className="text-gray-400">加载中...</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="text-left py-2 px-3 font-medium text-gray-500">时间</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">类型</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">操作者</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">目标</th>
            <th className="text-left py-2 px-3 font-medium text-gray-500">详情</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((log: any) => (
            <tr key={log.id} className="border-b border-gray-100 dark:border-gray-700/50">
              <td className="py-2 px-3 text-xs">
                {log.created_at ? new Date(log.created_at).toLocaleString('zh-CN') : '-'}
              </td>
              <td className="py-2 px-3">
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700">{log.log_type}</span>
              </td>
              <td className="py-2 px-3">{log.operator_type}:{log.operator_id}</td>
              <td className="py-2 px-3">{log.target_type}:{log.target_id}</td>
              <td className="py-2 px-3 text-xs text-gray-500 max-w-[200px] truncate">
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
      <div className="flex gap-2">
        {subTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              tab === t.key
                ? 'bg-primary-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
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

  if (!config) return <p className="text-gray-400">加载中...</p>

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 max-w-lg">
      <h3 className="font-semibold mb-4">全局设置</h3>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">启用 OpenCLI</label>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`w-12 h-6 rounded-full transition-colors ${enabled ? 'bg-green-500' : 'bg-gray-300'}`}
          >
            <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">默认速率限制（次/分钟）</label>
          <input type="number" value={rate} onChange={(e) => setRate(parseInt(e.target.value))}
            className="w-24 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">超时时间（秒）</label>
          <input type="number" value={timeout} onChange={(e) => setTimeout_(parseInt(e.target.value))}
            className="w-24 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm" />
        </div>
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm">
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

  if (!data.length) return <p className="text-gray-400">加载中...</p>

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h3 className="font-semibold mb-3">AI OpenCLI 白名单</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-2 px-3 font-medium text-gray-500">ID</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">名称</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">所属用户</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">OpenCLI</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">速率限制</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a: any) => (
              <tr key={a.agent_id} className="border-b border-gray-100 dark:border-gray-700/50">
                <td className="py-2 px-3">{a.agent_id}</td>
                <td className="py-2 px-3 font-medium">{a.agent_name}</td>
                <td className="py-2 px-3">{a.owner_id}</td>
                <td className="py-2 px-3">
                  <span className={a.enabled ? 'text-green-500' : 'text-gray-400'}>
                    {a.enabled ? '已启用' : '未启用'}
                  </span>
                </td>
                <td className="py-2 px-3">{a.actual_rate_limit}/分钟</td>
                <td className="py-2 px-3">
                  <button
                    onClick={() => toggleAgent(a.agent_id, a.enabled)}
                    className="text-xs text-primary-500 hover:text-primary-600"
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
function OpenCLICommandsSection() {
  const [data, setData] = useState<any[]>([])
  const [pattern, setPattern] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [desc, setDesc] = useState('')

  const load = async () => {
    const d = await api.get('/admin/opencli/commands')
    setData(Array.isArray(d) ? d : d.items || [])
  }

  useEffect(() => { load() }, [])

  const handleAdd = async () => {
    if (!pattern.trim()) return
    await api.post('/admin/opencli/commands', { pattern: pattern.trim(), is_regex: isRegex, description: desc || null })
    setPattern(''); setIsRegex(false); setDesc('')
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

  return (
    <div className="space-y-4">
      {/* 添加表单 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 max-w-lg">
        <h3 className="font-semibold mb-3">添加命令白名单</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs mb-1">命令/正则</label>
            <input value={pattern} onChange={(e) => setPattern(e.target.value)}
              className="w-40 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm"
              placeholder="bilibili 或 gh .*" />
          </div>
          <div className="flex items-center gap-1.5 mb-1">
            <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)}
              className="rounded" />
            <span className="text-xs">正则</span>
          </div>
          <div>
            <label className="block text-xs mb-1">描述</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)}
              className="w-32 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm"
              placeholder="可选" />
          </div>
          <button onClick={handleAdd}
            className="px-3 py-1.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 text-sm">
            添加
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="font-semibold mb-3">命令白名单列表</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-3 font-medium text-gray-500">模式</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">类型</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">描述</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">状态</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c: any) => (
                <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 px-3 font-mono text-xs">{c.pattern}</td>
                  <td className="py-2 px-3 text-xs">{c.is_regex ? '正则' : '精确'}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">{c.description || '-'}</td>
                  <td className="py-2 px-3">
                    <span className={c.enabled ? 'text-green-500 text-xs' : 'text-gray-400 text-xs'}>
                      {c.enabled ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td className="py-2 px-3 flex gap-2">
                    <button onClick={() => handleToggle(c.id, c.enabled)}
                      className="text-xs text-primary-500 hover:text-primary-600">
                      {c.enabled ? '禁用' : '启用'}
                    </button>
                    <button onClick={() => handleDelete(c.id)}
                      className="text-xs text-red-500 hover:text-red-600">
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-gray-400">暂无命令白名单</td></tr>
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

  if (!data) return <p className="text-gray-400">加载中...</p>

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <h3 className="font-semibold mb-3">使用日志</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-2 px-3 font-medium text-gray-500">时间</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">AI</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">命令</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">退出码</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">耗时</th>
              <th className="text-left py-2 px-3 font-medium text-gray-500">输出预览</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((log: any) => (
              <tr key={log.id} className="border-b border-gray-100 dark:border-gray-700/50">
                <td className="py-2 px-3 text-xs">
                  {log.executed_at ? new Date(log.executed_at).toLocaleString('zh-CN') : '-'}
                </td>
                <td className="py-2 px-3 text-xs">AI #{log.agent_id}</td>
                <td className="py-2 px-3 font-mono text-xs">
                  {log.command}{log.args ? ` ${log.args}` : ''}
                </td>
                <td className="py-2 px-3">
                  <span className={log.exit_code === 0 ? 'text-green-500 text-xs' : 'text-red-500 text-xs'}>
                    {log.exit_code}
                  </span>
                </td>
                <td className="py-2 px-3 text-xs">{log.duration_ms}ms</td>
                <td className="py-2 px-3 text-xs text-gray-500 max-w-[250px] truncate">
                  {log.stdout_truncated || log.stderr_truncated || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
          className="text-sm px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40">
          上一页
        </button>
        <button onClick={() => setPage(p => p + 1)} disabled={data.items.length < data.page_size}
          className="text-sm px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40">
          下一页
        </button>
      </div>
    </div>
  )
}
