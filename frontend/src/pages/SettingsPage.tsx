import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { Settings, Key, Zap, Save, Clock, Palette, Sun, Moon, Bell, Eye, EyeOff, CheckCircle, XCircle, Loader2, Globe, Layout } from 'lucide-react'

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
  { value: 'cozy', label: '舒适模式', enLabel: 'Cozy' },
  { value: 'compact', label: '紧凑模式', enLabel: 'Compact' },
]

export default function SettingsPage() {
  const { user, refreshUser } = useAuth()
  const { theme, toggleTheme } = useTheme()
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

  // 通知开关立即生效，不需点保存
  const handleNotificationToggle = (enabled: boolean) => {
    setNotifications(enabled)
    localStorage.setItem('notifications_enabled', enabled ? 'true' : 'false')
  }

  useEffect(() => {
    if (user) {
      api.get('/auth/me').then((data) => {
        if (data.api_base_url) setApiBaseUrl(data.api_base_url)
        setAutoTimeout(data.auto_approve_vector_timeout)
        setAutoDefault(data.auto_approve_vector_default)
        if (data.timezone) setTimezone(data.timezone)
        if (data.language) setLanguage(data.language)
        if (data.ui_prefs?.chat_style) {
          setChatStyle(data.ui_prefs.chat_style)
        }
      }).catch(console.error)
    }
  }, [user])

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const baseUrl = apiBaseUrl || 'https://api.deepseek.com'
      const key = apiKey || null
      // 发一个简单的 models list 请求验证
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (key) headers['Authorization'] = `Bearer ${key}`
      const res = await fetch(`${baseUrl}/v1/models`, { headers })
      if (res.ok) {
        setTestResult('success')
      } else {
        const body = await res.text()
        setTestResult('fail')
        console.warn('API test failed:', res.status, body)
      }
    } catch {
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
      refreshUser()
    } catch (err: any) {
      setMessage(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 bg-canvas">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-textPrimary mb-6 tracking-tight">设置</h1>

        {/* API 配置 */}
        <div className="bg-surface rounded-xl border border-border p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Key size={18} className="text-primary-400" />
            <h2 className="font-semibold text-textPrimary">API 配置</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5 text-textSecondary">Base URL</label>
              <input
                type="text"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                placeholder="https://api.deepseek.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5 text-textSecondary">API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-3.5 py-2.5 pr-10 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                  placeholder={user?.has_api_key ? '留空表示不修改（已设置）' : '输入你的 API Key'}
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
                    ? '✅ 已设置 API Key'
                    : '⚠️ 尚未设置 API Key'}
                </p>
                <button
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 disabled:opacity-50 transition-colors"
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
        </div>

        {/* 时区设置 */}
        <div className="bg-surface rounded-xl border border-border p-6 mb-4">
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
        <div className="bg-surface rounded-xl border border-border p-6 mb-4">
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
        <div className="bg-surface rounded-xl border border-border p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Layout size={18} className="text-primary-400" />
            <h2 className="font-semibold text-textPrimary">聊天样式</h2>
          </div>
          <div className="flex gap-3">
            {CHAT_STYLES.map((s) => (
              <button
                key={s.value}
                onClick={() => setChatStyle(s.value)}
                className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                  chatStyle === s.value
                    ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                    : 'border-border bg-canvas text-textSecondary hover:border-primary-500/30'
                }`}
              >
                {language === 'en' ? s.enLabel : s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 策略模式 */}
        <div className="bg-surface rounded-xl border border-border p-6 mb-4">
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
        <div className="bg-surface rounded-xl border border-border p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Palette size={18} className="text-primary-400" />
            <h2 className="font-semibold text-textPrimary">外观</h2>
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
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
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
        <div className="bg-surface rounded-xl border border-border p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Bell size={18} className="text-primary-400" />
            <h2 className="font-semibold text-textPrimary">桌面通知</h2>
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
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
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
      </div>
    </div>
  )
}
