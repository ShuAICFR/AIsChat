import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { Key, Zap, Save, Clock, Palette, Sun, Moon, Bell, Eye, EyeOff, CheckCircle, XCircle, Loader2, Globe, Layout, Bot, Pencil, X, Ticket, Plus, ChevronDown, ChevronRight, Shield, AlertTriangle, Menu } from 'lucide-react'
import { useNavigate, useBlocker, useOutletContext, useLocation } from 'react-router-dom'

// 常用时区列表
const TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Pacific/Auckland',
  'Australia/Sydney',
  'UTC',
]

const LANGUAGES = [
  { code: 'zh', name: '中文（简体）' },
  { code: 'en', name: 'English' },
]

const CHAT_STYLES = [
  { value: 'cozy', label: '舒适模式', enLabel: 'Cozy', desc: '气泡间距宽松，头像较大，适合长时间阅读', enDesc: 'Relaxed bubble spacing, larger avatars' },
  { value: 'compact', label: '紧凑模式', enLabel: 'Compact', desc: '气泡排列紧密，信息密度高，适合快速浏览', enDesc: 'Dense message layout, high information density' },
]

export default function SettingsPage() {
  const { user, refreshUser } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const { openDrawer } = useOutletContext<{ openDrawer: () => void }>()
  const [apiBaseUrl, setApiBaseUrl] = useState('https://api.deepseek.com')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null)
  const [autoTimeout, setAutoTimeout] = useState(60)
  const [autoDefault, setAutoDefault] = useState(false)
  const [timezone, setTimezone] = useState('Asia/Shanghai')
  const [language, setLanguage] = useState('zh')
  const [chatStyle, setChatStyle] = useState('cozy')
  const [notifications, setNotifications] = useState<boolean>(() => {
    const stored = localStorage.getItem('notifications_enabled')
    return stored === null ? true : stored === 'true'
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [agents, setAgents] = useState<any[]>([])
  const [editingAgentId, setEditingAgentId] = useState<number | null>(null)
  const [agentApiBaseUrl, setAgentApiBaseUrl] = useState('')
  const [agentApiKey, setAgentApiKey] = useState('')
  const [agentApiSaving, setAgentApiSaving] = useState(false)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState('')
  const [showAgentApi, setShowAgentApi] = useState(false)

  // ── 未保存修改检测 ──
  const [savedValues, setSavedValues] = useState<{
    apiBaseUrl: string; autoTimeout: number; autoDefault: boolean
    timezone: string; language: string; chatStyle: string
  } | null>(null)

  // 判断是否有未保存修改（apiKey 非空才算修改）
  const hasUnsavedChanges = savedValues !== null && (
    apiBaseUrl !== savedValues.apiBaseUrl ||
    autoTimeout !== savedValues.autoTimeout ||
    autoDefault !== savedValues.autoDefault ||
    timezone !== savedValues.timezone ||
    language !== savedValues.language ||
    chatStyle !== savedValues.chatStyle ||
    apiKey.trim() !== ''  // 有输入即视为修改
  )

  // 导航拦截
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges && currentLocation.pathname !== nextLocation.pathname
  )

  // 浏览器关闭/刷新拦截
  useEffect(() => {
    if (!hasUnsavedChanges) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedChanges])

  // 通知开关立即生效，不需点保存
  const handleNotificationToggle = (enabled: boolean) => {
    setNotifications(enabled)
    localStorage.setItem('notifications_enabled', enabled ? 'true' : 'false')
  }

  useEffect(() => {
    if (user) {
      api.get('/auth/me').then((data) => {
        const apiUrl = data.api_base_url || 'https://api.deepseek.com'
        const tz = data.timezone || 'Asia/Shanghai'
        const lang = data.language || 'zh'
        const style = data.ui_prefs?.chat_style || 'cozy'
        const to = data.auto_approve_vector_timeout ?? 60
        const ad = data.auto_approve_vector_default ?? false
        setApiBaseUrl(apiUrl)
        setAutoTimeout(to)
        setAutoDefault(ad)
        if (data.timezone) setTimezone(tz)
        if (data.language) setLanguage(lang)
        if (data.ui_prefs?.chat_style) setChatStyle(style)
        // 保存快照用于未保存修改检测
        setSavedValues({
          apiBaseUrl: apiUrl,
          autoTimeout: to,
          autoDefault: ad,
          timezone: tz,
          language: lang,
          chatStyle: style,
        })
      }).catch(console.error)
      // 加载我的 AI 列表（用于单 AI API 配置）
      api.get<any[]>('/agents').then(list => {
        setAgents(list || [])
      }).catch(() => {})
    }
  }, [user])

  // Hash 导航：从 /settings#api 自动滚动到对应区块
  const location = useLocation()
  useEffect(() => {
    const hash = location.hash?.replace('#', '')
    if (hash) {
      // 延迟等 DOM 渲染完成
      const timer = setTimeout(() => {
        document.getElementById(`settings-${hash}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [location.hash])

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const data = await api.post<{ ok: boolean; message: string }>('/user/test-api-connection', {
        api_base_url: apiBaseUrl || null,
        api_key: apiKey || null,
      })
      setTestResult(data.ok ? 'success' : 'fail')
    } catch (err: any) {
      setTestResult('fail')
    } finally {
      setTesting(false)
      setTimeout(() => setTestResult(null), 5000)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      await api.put('/user/settings', {
        api_base_url: apiBaseUrl || null,
        api_key: apiKey || null,
        auto_approve_vector_timeout: autoTimeout,
        auto_approve_vector_default: autoDefault,
        timezone,
        language,
        ui_prefs: { chat_style: chatStyle },
      })
      setApiKey('')
      setMessage('设置已保存')
      // 更新快照以清除"未保存"状态
      setSavedValues({
        apiBaseUrl: apiBaseUrl || '',
        autoTimeout,
        autoDefault,
        timezone,
        language,
        chatStyle,
      })
      refreshUser()
      // 刷新 AI 列表以更新独立 API 状态
      api.get<any[]>('/agents').then(list => setAgents(list || [])).catch(() => {})
    } catch (err: any) {
      setMessage(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAgentApi = async (agentId: number) => {
    setAgentApiSaving(true)
    try {
      await api.put(`/agents/${agentId}/config`, {
        api_base_url: agentApiBaseUrl || null,
        api_key: agentApiKey || null,
      })
      setEditingAgentId(null)
      setAgentApiKey('')
      // 刷新列表
      api.get<any[]>('/agents').then(list => setAgents(list || [])).catch(() => {})
    } catch (err: any) {
      alert(err.message || '保存失败')
    } finally {
      setAgentApiSaving(false)
    }
  }

  const startEditAgentApi = (agent: any) => {
    setEditingAgentId(agent.id)
    setAgentApiBaseUrl(agent.api_base_url || '')
    setAgentApiKey('')
  }

  const handleRedeem = async () => {
    if (!redeemCode.trim()) return
    setRedeeming(true)
    setRedeemMsg('')
    try {
      const data = await api.post<{ message: string }>('/user/redeem', { code: redeemCode.trim() })
      setRedeemMsg(data.message || '兑换成功')
      setRedeemCode('')
      refreshUser()
    } catch (err: any) {
      setRedeemMsg(err.message || '兑换失败')
    } finally {
      setRedeeming(false)
      setTimeout(() => setRedeemMsg(''), 4000)
    }
  }

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
        <h1 className="font-semibold text-textPrimary text-sm">设置</h1>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-2xl mx-auto">

        {/* 移动端管理员快捷入口 */}
        {user?.role === 'admin' && (
          <button
            onClick={() => navigate('/admin')}
            className="md:hidden w-full flex items-center justify-center gap-2 px-4 py-3 mb-4 rounded-xl bg-primary-500/10 border border-primary-500/20 text-primary-400 hover:bg-primary-500/15 text-sm font-medium transition-colors"
          >
            <Shield size={16} />
            管理面板
          </button>
        )}

        {/* 额度 */}
        <div className="bg-surface rounded-xl border border-border p-3 md:p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={18} className="text-primary-400" />
            <h2 className="font-semibold text-textPrimary">额度</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-canvas rounded-xl p-4 border border-border">
              <p className="text-xs text-textMuted mb-1">AI 创建额度</p>
              <p className="text-2xl font-bold text-textPrimary">{user?.ai_quota ?? 0}</p>
              <p className="text-[10px] text-textMuted mt-1">每创建一个 AI 消耗 1 额度</p>
            </div>
            <div className="bg-canvas rounded-xl p-4 border border-border">
              <p className="text-xs text-textMuted mb-1">API 调用余额</p>
              <p className="text-2xl font-bold text-textPrimary">{user?.api_credit ?? 0}</p>
              <p className="text-[10px] text-textMuted mt-1">每次 LLM 调用从此余额扣除</p>
            </div>
          </div>
          {/* 兑换码 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <Ticket size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
              <input
                type="text"
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                placeholder="输入兑换码（如 RC-xxxxxxxxxxxxxxxx）"
              />
            </div>
            <button
              onClick={handleRedeem}
              disabled={redeeming || !redeemCode.trim()}
              className="flex items-center gap-1 px-4 py-2 rounded-xl bg-primary-500 text-white text-sm font-medium hover:bg-primary-400 disabled:opacity-40 transition-colors shrink-0"
            >
              {redeeming ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              兑换
            </button>
          </div>
          {redeemMsg && (
            <p className={`text-xs mt-2 ${redeemMsg.includes('失败') ? 'text-rose-400' : 'text-mint-400'}`}>
              {redeemMsg}
            </p>
          )}
        </div>

        {/* API 提供商配置 */}
        <div id="settings-api" className="bg-surface rounded-xl border border-border p-3 md:p-6 mb-4 scroll-mt-16">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Key size={18} className="text-primary-400 shrink-0" />
            <h2 className="font-semibold text-textPrimary whitespace-nowrap shrink-0">API 提供商配置</h2>
            <span className="text-[10px] text-textMuted ml-auto">以下为全局默认，所有 AI 共用</span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5 text-textSecondary">Base URL</label>
              <input
                type="text"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                placeholder="例: https://api.deepseek.com"
              />
              <p className="text-[10px] text-textMuted mt-1">API 服务地址，需兼容 OpenAI 接口格式。也可填第三方代理地址</p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 text-textSecondary">API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  placeholder={user?.has_api_key ? '留空表示不修改（已设置）' : '输入 API Key，如 sk-xxxxxxxx'}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-textMuted hover:text-textSecondary"
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-xs text-textMuted">
                  {user?.has_api_key
                    ? <><CheckCircle size={12} className="inline text-mint-400 mr-1" />已设置 API Key</>
                    : <><AlertTriangle size={12} className="inline text-accent-400 mr-1" />尚未设置 API Key</>}
                </p>
                <button
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 disabled:opacity-50 transition-colors"
                >
                  {testing ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : testResult === 'success' ? (
                    <CheckCircle size={12} className="text-mint-400" />
                  ) : testResult === 'fail' ? (
                    <XCircle size={12} className="text-rose-400" />
                  ) : null}
                  {testing ? '测试中...' : testResult === 'success' ? '连接成功' : testResult === 'fail' ? '连接失败' : '测试连接'}
                </button>
              </div>
            </div>
          </div>

          {/* 单 AI API 配置（可折叠） */}
          <div className="mt-4 pt-4 border-t border-border">
            <button
              onClick={() => setShowAgentApi(!showAgentApi)}
              className="flex items-center gap-2 w-full text-left hover:bg-canvas/50 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
            >
              {showAgentApi ? <ChevronDown size={16} className="text-textMuted" /> : <ChevronRight size={16} className="text-textMuted" />}
              <Bot size={16} className="text-primary-400" />
              <span className="text-sm font-medium text-textPrimary">单 AI 配置（设置独立 API）</span>
              <span className="text-[10px] text-textMuted">（为特定 AI 设置独立 API，覆盖全局）</span>
            </button>

            {showAgentApi && (
              <div className="mt-3">
                {agents.length === 0 ? (
                  <p className="text-xs text-textMuted py-4 text-center">暂无 AI，创建 AI 后可为每个 AI 配置独立 API</p>
                ) : (
                  <div className="space-y-2">
                    {agents.map((agent: any) => (
                      <div key={agent.id} className="bg-canvas rounded-xl border border-border p-3">
                        {editingAgentId === agent.id ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-textPrimary">{agent.name}</span>
                              <button onClick={() => setEditingAgentId(null)} className="text-textMuted hover:text-textSecondary">
                                <X size={14} />
                              </button>
                            </div>
                            <input
                              type="text"
                              value={agentApiBaseUrl}
                              onChange={(e) => setAgentApiBaseUrl(e.target.value)}
                              className="w-full px-3 py-1.5 rounded-lg border border-border bg-surface text-xs text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-1 focus:ring-primary-500/50"
                              placeholder="例: https://api.deepseek.com（留空则继承全局）"
                            />
                            <input
                              type="password"
                              value={agentApiKey}
                              onChange={(e) => setAgentApiKey(e.target.value)}
                              className="w-full px-3 py-1.5 rounded-lg border border-border bg-surface text-xs text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-1 focus:ring-primary-500/50"
                              placeholder="例: sk-xxxxxxxx（留空则继承全局）"
                            />
                            <button
                              onClick={() => handleSaveAgentApi(agent.id)}
                              disabled={agentApiSaving}
                              className="w-full py-1.5 rounded-lg bg-primary-500 text-white text-xs font-medium hover:bg-primary-400 disabled:opacity-40 transition-colors"
                            >
                              {agentApiSaving ? '保存中...' : '保存'}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-sm text-textPrimary">{agent.name}</span>
                              {agent.api_base_url ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-400">
                                  独立 API
                                </span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-border/30 text-textMuted">
                                  继承全局
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => startEditAgentApi(agent)}
                              className="text-textMuted hover:text-textSecondary transition-colors"
                            >
                              <Pencil size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 时区设置 */}
        <div className="bg-surface rounded-xl border border-border p-3 md:p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={18} className="text-primary-400" />
            <h2 className="font-semibold text-textPrimary">时区</h2>
          </div>
          <p className="text-xs text-textMuted mb-3">消息时间将按此时区显示</p>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
          <p className="text-xs text-textMuted mt-2">
            当前: {new Date().toLocaleString('zh-CN', { timeZone: timezone })}
          </p>
        </div>

        {/* 语言设置 */}
        <div id="settings-language" className="bg-surface rounded-xl border border-border p-3 md:p-6 mb-4 scroll-mt-16">
          <div className="flex items-center gap-2 mb-4">
            <Globe size={18} className="text-primary-400" />
            <h2 className="font-semibold text-textPrimary">语言</h2>
          </div>
          <p className="text-xs text-textMuted mb-3">界面和 AI 系统提示词将使用所选语言</p>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </div>

        {/* 聊天样式 */}
        <div className="bg-surface rounded-xl border border-border p-3 md:p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Layout size={18} className="text-primary-400" />
            <h2 className="font-semibold text-textPrimary">聊天样式</h2>
          </div>
          <p className="text-xs text-textMuted mb-3">控制群聊和私信界面中消息气泡的间距与布局风格</p>
          <div className="flex gap-3">
            {CHAT_STYLES.map((s) => (
              <button
                key={s.value}
                onClick={() => setChatStyle(s.value)}
                className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-all text-left ${
                  chatStyle === s.value
                    ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                    : 'border-border bg-canvas text-textSecondary hover:border-primary-500/30'
                }`}
              >
                <div className="font-medium">{language === 'en' ? s.enLabel : s.label}</div>
                <div className="text-[10px] mt-0.5 opacity-70">{language === 'en' ? s.enDesc : s.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 策略模式 */}
        <div className="bg-surface rounded-xl border border-border p-3 md:p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={18} className="text-primary-400" />
            <h2 className="font-semibold text-textPrimary">策略模式</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5 text-textSecondary">
                自动审批超时（秒）: {autoTimeout}
              </label>
              <input
                type="range"
                min="10"
                max="300"
                step="10"
                value={autoTimeout}
                onChange={(e) => setAutoTimeout(parseInt(e.target.value))}
                className="w-full accent-primary-500"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDefault}
                  onChange={(e) => setAutoDefault(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-border peer-focus:ring-2 peer-focus:ring-primary-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-primary-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all" />
              </label>
              <span className="text-sm text-textSecondary">默认同意向量加速申请</span>
            </div>
          </div>
        </div>

        {/* 外观主题 */}
        <div id="settings-appearance" className="bg-surface rounded-xl border border-border p-3 md:p-6 mb-4 scroll-mt-16">
          <div className="flex items-center gap-2 mb-4">
            <Palette size={18} className="text-primary-400" />
            <h2 className="font-semibold text-textPrimary">外观</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-mint-400/10 text-mint-400 border border-mint-400/20">即时生效</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-textPrimary">界面主题</p>
              <p className="text-xs text-textMuted mt-0.5">
                {theme === 'dark' ? '当前：深色模式（深邃紫金）' : '当前：浅色模式'}
              </p>
            </div>
            <button
              onClick={toggleTheme}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${
                theme === 'dark'
                  ? 'bg-primary-600'
                  : 'bg-[#CBD5E1]'
              }`}
            >
              <span
                className={`inline-flex items-center justify-center h-6 w-6 rounded-full bg-white shadow-md transition-transform ${
                  theme === 'dark' ? 'translate-x-7' : 'translate-x-1'
                }`}
              >
                {theme === 'dark' ? (
                  <Moon size={12} className="text-primary-500" />
                ) : (
                  <Sun size={12} className="text-accent-500" />
                )}
              </span>
            </button>
          </div>
        </div>

        {/* 桌面通知 */}
        <div className="bg-surface rounded-xl border border-border p-3 md:p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Bell size={18} className="text-primary-400" />
            <h2 className="font-semibold text-textPrimary">桌面通知</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-mint-400/10 text-mint-400 border border-mint-400/20">即时生效</span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-textPrimary">标签页未读标记</p>
              <p className="text-xs text-textMuted mt-0.5">
                切换标签页时在标题栏显示未读消息数，有新消息时任务栏闪烁（免打扰的群和私信不计入）
              </p>
            </div>
            <button
              onClick={() => handleNotificationToggle(!notifications)}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors flex-shrink-0 ml-4 ${
                notifications
                  ? 'bg-primary-600'
                  : 'bg-[#CBD5E1]'
              }`}
            >
              <span
                className={`inline-block h-6 w-6 rounded-full bg-white shadow-md transition-transform ${
                  notifications ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 保存按钮 */}
        {message && (
          <div className={`text-sm px-3 py-2 rounded-xl mb-4 ${
            message.includes('失败') || message.includes('错误')
              ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
              : 'bg-mint-400/10 border border-mint-400/20 text-mint-400'
          }`}>
            {message}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-30 text-sm font-medium transition-all shadow-lg shadow-primary-500/20"
        >
          <Save size={16} />
          {saving ? '保存中...' : '保存设置'}
        </button>
        <p className="text-xs text-textMuted mt-2">
          标有「即时生效」的选项修改后立即应用，无需点击保存。其余选项需点击保存后生效。
        </p>
      </div>

      {/* ── 未保存修改离开确认弹窗 ── */}
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl shadow-black/30">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-accent-500/10 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-accent-500" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-textPrimary">未保存的修改</h3>
                <p className="text-sm text-textSecondary mt-1">
                  你有尚未保存的设置修改。离开此页面将丢失这些更改。确定要离开吗？
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => blocker.reset?.()}
                className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-elevated text-textSecondary transition-colors font-medium"
              >
                继续编辑
              </button>
              <button
                onClick={() => blocker.proceed?.()}
                className="flex-1 py-2.5 text-sm bg-rose-500 text-white rounded-xl hover:bg-rose-400 font-medium transition-all"
              >
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
