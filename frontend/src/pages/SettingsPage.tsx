import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { Settings, Key, Zap, Save, Clock } from 'lucide-react'

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

export default function SettingsPage() {
  const { user, refreshUser } = useAuth()
  const [apiBaseUrl, setApiBaseUrl] = useState('https://api.deepseek.com')
  const [apiKey, setApiKey] = useState('')
  const [autoTimeout, setAutoTimeout] = useState(60)
  const [autoDefault, setAutoDefault] = useState(false)
  const [timezone, setTimezone] = useState('Asia/Shanghai')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (user) {
      // 从 /auth/me 加载当前设置
      api.get('/auth/me').then((data) => {
        if (data.api_base_url) setApiBaseUrl(data.api_base_url)
        setAutoTimeout(data.auto_approve_vector_timeout)
        setAutoDefault(data.auto_approve_vector_default)
        if (data.timezone) setTimezone(data.timezone)
      }).catch(console.error)
    }
  }, [user])

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
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">设置</h1>

        {/* API 配置 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Key size={18} className="text-primary-500" />
            <h2 className="font-semibold">API 配置</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Base URL</label>
              <input
                type="text"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="https://api.deepseek.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="留空表示不修改"
              />
              <p className="text-xs text-gray-400 mt-1">
                {user?.has_api_key ? '已设置 API Key（重新输入将覆盖）' : '尚未设置 API Key'}
              </p>
            </div>
          </div>
        </div>

        {/* 时区设置 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={18} className="text-primary-500" />
            <h2 className="font-semibold">时区</h2>
          </div>
          <p className="text-xs text-gray-400 mb-3">消息时间将按此时区显示</p>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-2">
            当前: {new Date().toLocaleString('zh-CN', { timeZone: timezone })}
          </p>
        </div>

        {/* 策略模式 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={18} className="text-primary-500" />
            <h2 className="font-semibold">策略模式</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                自动审批超时（秒）: {autoTimeout}
              </label>
              <input
                type="range"
                min="10"
                max="300"
                step="10"
                value={autoTimeout}
                onChange={(e) => setAutoTimeout(parseInt(e.target.value))}
                className="w-full"
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
                <div className="w-9 h-5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:bg-primary-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all" />
              </label>
              <span className="text-sm">默认同意向量加速申请</span>
            </div>
          </div>
        </div>

        {/* 保存按钮 */}
        {message && (
          <div className={`text-sm px-3 py-2 rounded-lg mb-4 ${
            message.includes('失败') || message.includes('错误')
              ? 'bg-red-50 dark:bg-red-900/20 text-red-500'
              : 'bg-green-50 dark:bg-green-900/20 text-green-500'
          }`}>
            {message}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-40 text-sm font-medium transition-colors"
        >
          <Save size={16} />
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>
    </div>
  )
}
