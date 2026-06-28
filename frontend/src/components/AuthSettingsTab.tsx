import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { useT } from '../i18n/I18nContext'
import { Mail, Shield, CheckCircle, XCircle, Loader2 } from 'lucide-react'

interface AuthSettingsData {
  require_email_verification: boolean
  login_providers: string[]
  smtp_configured: boolean
  smtp_config: {
    host: string
    port: number
    username: string
    from_email: string
    from_name: string
    use_tls: boolean
    has_password: boolean
  } | null
}

interface SmtpFormData {
  host: string
  port: number
  username: string
  password: string
  from_email: string
  from_name: string
  use_tls: boolean
}

const PROVIDER_OPTIONS = [
  { key: 'direct', labelKey: 'admin.loginProviderDirect' },
  { key: 'email_code', labelKey: 'admin.loginProviderEmail' },
  { key: 'wechat', labelKey: 'admin.loginProviderWechat' },
  { key: 'qq', labelKey: 'admin.loginProviderQQ' },
]

export default function AuthSettingsTab() {
  const t = useT()
  const [settings, setSettings] = useState<AuthSettingsData | null>(null)
  const [loading, setLoading] = useState(true)

  // SMTP 表单
  const [smtp, setSmtp] = useState<SmtpFormData>({
    host: '', port: 587, username: '', password: '',
    from_email: '', from_name: 'AIsChat', use_tls: true,
  })
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [smtpTesting, setSmtpTesting] = useState(false)
  const [smtpTestResult, setSmtpTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // 验证开关 + 登录方式
  const [reqVerification, setReqVerification] = useState(false)
  const [providers, setProviders] = useState<string[]>(['direct'])
  const [authSaving, setAuthSaving] = useState(false)

  const loadSettings = async () => {
    try {
      const data = await api.get<AuthSettingsData>('/admin/auth-settings')
      setSettings(data)
      setReqVerification(data.require_email_verification)
      setProviders(data.login_providers)
      if (data.smtp_config) {
        setSmtp({
          host: data.smtp_config.host || '',
          port: data.smtp_config.port || 587,
          username: data.smtp_config.username || '',
          password: '',
          from_email: data.smtp_config.from_email || '',
          from_name: data.smtp_config.from_name || 'AIsChat',
          use_tls: data.smtp_config.use_tls !== false,
        })
      }
    } catch { /* */ } finally { setLoading(false) }
  }

  useEffect(() => { loadSettings() }, [])

  const handleSaveSmtp = async () => {
    setSmtpSaving(true)
    setSmtpTestResult(null)
    try {
      await api.put('/admin/smtp-config', smtp)
      await loadSettings()
    } catch (err: any) {
      setSmtpTestResult({ ok: false, msg: err.message || 'Save failed' })
    } finally { setSmtpSaving(false) }
  }

  const handleTestSmtp = async () => {
    setSmtpTesting(true)
    setSmtpTestResult(null)
    try {
      const res = await api.post<{ success: boolean; message: string }>('/admin/smtp-test', smtp)
      setSmtpTestResult({ ok: res.success, msg: res.message })
    } catch (err: any) {
      setSmtpTestResult({ ok: false, msg: err.message || 'Test failed' })
    } finally { setSmtpTesting(false) }
  }

  const handleSaveAuth = async () => {
    if (providers.length < 1) return
    setAuthSaving(true)
    try {
      await api.put('/admin/auth-settings', {
        require_email_verification: reqVerification,
        login_providers: providers,
      })
      await loadSettings()
    } catch { /* */ } finally { setAuthSaving(false) }
  }

  const toggleProvider = (key: string) => {
    if (providers.includes(key)) {
      if (providers.length <= 1) return // 至少保留一种
      setProviders(prev => prev.filter(p => p !== key))
    } else {
      setProviders(prev => [...prev, key])
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-textMuted" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* ── SMTP 配置 ── */}
      <section className="bg-surface border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-textPrimary flex items-center gap-2 mb-1">
          <Mail size={16} className="text-primary-400" />
          {t('admin.smtpConfig')}
        </h3>
        <p className="text-xs text-textMuted mb-4">{t('admin.authDesc')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-textSecondary mb-1">{t('admin.smtpHost')}</label>
            <input
              type="text" value={smtp.host}
              onChange={e => setSmtp({ ...smtp, host: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-textPrimary text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/60"
              placeholder="smtp.example.com"
            />
          </div>
          <div>
            <label className="block text-xs text-textSecondary mb-1">{t('admin.smtpPort')}</label>
            <input
              type="number" value={smtp.port}
              onChange={e => setSmtp({ ...smtp, port: parseInt(e.target.value) || 587 })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-textPrimary text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/60"
            />
          </div>
          <div>
            <label className="block text-xs text-textSecondary mb-1">{t('admin.smtpUsername')}</label>
            <input
              type="text" value={smtp.username}
              onChange={e => setSmtp({ ...smtp, username: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-textPrimary text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/60"
            />
          </div>
          <div>
            <label className="block text-xs text-textSecondary mb-1">{t('admin.smtpPassword')}</label>
            <input
              type="password" value={smtp.password}
              onChange={e => setSmtp({ ...smtp, password: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-textPrimary text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/60"
              placeholder={settings?.smtp_config?.has_password ? t('admin.smtpPasswordPlaceholder') : ''}
            />
          </div>
          <div>
            <label className="block text-xs text-textSecondary mb-1">{t('admin.smtpFromEmail')}</label>
            <input
              type="email" value={smtp.from_email}
              onChange={e => setSmtp({ ...smtp, from_email: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-textPrimary text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/60"
              placeholder="noreply@example.com"
            />
          </div>
          <div>
            <label className="block text-xs text-textSecondary mb-1">{t('admin.smtpFromName')}</label>
            <input
              type="text" value={smtp.from_name}
              onChange={e => setSmtp({ ...smtp, from_name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-textPrimary text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/60"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <input
            type="checkbox" checked={smtp.use_tls}
            onChange={e => setSmtp({ ...smtp, use_tls: e.target.checked })}
            id="smtp-tls" className="rounded"
          />
          <label htmlFor="smtp-tls" className="text-xs text-textSecondary">{t('admin.smtpUseTls')}</label>
        </div>

        {/* 测试结果 */}
        {smtpTestResult && (
          <div className={`mt-3 text-xs rounded-lg px-3 py-2 flex items-center gap-2 ${
            smtpTestResult.ok ? 'bg-mint-500/10 text-mint-400 border border-mint-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
          }`}>
            {smtpTestResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
            {smtpTestResult.msg}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleTestSmtp}
            disabled={!smtp.host || !smtp.username || smtpTesting}
            className="px-4 py-2 text-sm rounded-lg border border-border text-textSecondary hover:text-textPrimary hover:bg-elevated disabled:opacity-30 transition-colors"
          >
            {smtpTesting ? t('admin.smtpTesting') : t('admin.smtpTest')}
          </button>
          <button
            onClick={handleSaveSmtp}
            disabled={!smtp.host || !smtp.from_email || smtpSaving}
            className="px-4 py-2 text-sm rounded-lg bg-primary-500 hover:bg-primary-400 disabled:opacity-30 text-white font-medium transition-colors"
          >
            {smtpSaving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </section>

      {/* ── 认证设置 ── */}
      <section className="bg-surface border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-textPrimary flex items-center gap-2 mb-4">
          <Shield size={16} className="text-amber-400" />
          {t('admin.auth')}
        </h3>

        {/* 邮箱验证开关 */}
        <div className="flex items-center justify-between py-3 border-b border-border/60">
          <div>
            <span className="text-sm text-textPrimary">{t('admin.requireEmailVerification')}</span>
            <p className="text-xs text-textMuted mt-0.5">{t('admin.requireEmailVerificationDesc')}</p>
            {!settings?.smtp_configured && (
              <p className="text-xs text-amber-400 mt-1">⚠ {t('admin.requireEmailVerificationWarning')}</p>
            )}
          </div>
          <button
            onClick={() => setReqVerification(!reqVerification)}
            disabled={!settings?.smtp_configured}
            className={`relative w-10 h-6 rounded-full transition-colors disabled:opacity-30 ${
              reqVerification ? 'bg-primary-500' : 'bg-border'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              reqVerification ? 'translate-x-4' : ''
            }`} />
          </button>
        </div>

        {/* 登录方式多选 */}
        <div className="py-3">
          <span className="text-sm text-textPrimary">{t('admin.loginProviders')}</span>
          <p className="text-xs text-textMuted mt-0.5 mb-3">{t('admin.loginProvidersDesc')}</p>
          <div className="flex flex-wrap gap-2">
            {PROVIDER_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => toggleProvider(opt.key)}
                disabled={providers.includes(opt.key) && providers.length <= 1}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors border ${
                  providers.includes(opt.key)
                    ? 'bg-primary-500/10 border-primary-500/30 text-primary-500'
                    : 'bg-canvas border-border text-textMuted hover:text-textSecondary'
                } disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSaveAuth}
          disabled={authSaving || providers.length < 1}
          className="mt-3 px-4 py-2 text-sm rounded-lg bg-primary-500 hover:bg-primary-400 disabled:opacity-30 text-white font-medium transition-colors"
        >
          {authSaving ? t('common.saving') : t('common.save')}
        </button>
      </section>
    </div>
  )
}
