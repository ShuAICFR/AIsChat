import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useT } from '../i18n/I18nContext'
import { cacheLangForUnauth } from '../i18n/I18nContext'
import { api } from '../api/client'
import { MessageCircle, Mail } from 'lucide-react'

/** 登录方式对应的 provider 标签 */
const METHOD_LABELS: Record<string, string> = {
  direct: 'auth.methodDirect',
  email_code: 'auth.methodEmail',
  wechat: 'auth.methodWechat',
  qq: 'auth.methodQQ',
}

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasExistingUsers, setHasExistingUsers] = useState<boolean | null>(null)

  // v1.0.0 邮箱认证
  const [providers, setProviders] = useState<string[]>(['direct'])
  const [requireEmailVerification, setRequireEmailVerification] = useState(false)
  const [loginMethod, setLoginMethod] = useState<string>('direct')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [sendCooldown, setSendCooldown] = useState(0)

  const { login, register } = useAuth()
  const navigate = useNavigate()
  const t = useT()

  // 检查是否已有用户 + 获取登录方式配置
  useEffect(() => {
    api.get<{ has_users: boolean }>('/auth/has-users')
      .then(r => setHasExistingUsers(r.has_users))
      .catch(() => setHasExistingUsers(true))
    // 获取可用的登录方式
    api.get<{ default_language: string; login_providers?: string[]; require_email_verification?: boolean }>('/system/settings')
      .then(r => {
        cacheLangForUnauth(r.default_language === 'zh' ? 'zh' : 'en')
        if (r.login_providers && r.login_providers.length > 0) {
          setProviders(r.login_providers)
          // 默认选第一个可用方式
          if (!r.login_providers.includes(loginMethod)) {
            setLoginMethod(r.login_providers[0])
          }
        }
        setRequireEmailVerification(r.require_email_verification || false)
      })
      .catch(() => {})
  }, [])

  // 验证码发送冷却倒计时
  useEffect(() => {
    if (sendCooldown <= 0) return
    const timer = setInterval(() => setSendCooldown(c => c - 1), 1000)
    return () => clearInterval(timer)
  }, [sendCooldown])

  const handleSendCode = useCallback(async () => {
    if (!email || sendCooldown > 0) return
    setError('')
    try {
      const purpose = mode === 'register' ? 'register' : 'login'
      await api.post('/auth/send-verification-code', { email, purpose })
      setCodeSent(true)
      setSendCooldown(60)
    } catch (err: any) {
      setError(err.message || t('common.error'))
    }
  }, [email, sendCooldown, mode, t])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        if (loginMethod === 'email_code') {
          // 邮箱验证码登录
          await login(email, '', { method: 'email_code', code })
        } else {
          // 用户名+密码登录
          await login(username, password)
        }
      } else {
        // 注册
        const opts: any = {}
        if (email) opts.email = email
        if (code) opts.code = code
        await register(username, password, opts)
      }
      navigate('/chat')
    } catch (err: any) {
      setError(err.message || t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  const showEmailFields = loginMethod === 'email_code' || (mode === 'register' && requireEmailVerification)
  const showDirectFields = loginMethod === 'direct'
  const canSubmit = loading && (showDirectFields ? (!username || !password) : (!email || !code))

  // 可用的登录方式标签
  const availableMethods = providers.length > 0 ? providers : ['direct']

  return (
    <div className="min-h-screen flex bg-canvas relative overflow-hidden">
      {/* 背景星点 */}
      <div className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: `radial-gradient(circle at 25% 30%, rgba(167,139,250,0.08) 0.5px, transparent 0.5px),
                           radial-gradient(circle at 75% 60%, rgba(167,139,250,0.06) 1px, transparent 1px),
                           radial-gradient(circle at 40% 80%, rgba(251,191,36,0.05) 0.8px, transparent 0.8px)`,
          backgroundSize: '80px 80px, 120px 120px, 100px 100px',
        }}
      />

      <div className="relative z-10 flex flex-col items-center justify-center w-full px-4">
        {/* 标志 */}
        <div className="mb-10 text-center">
          <div className="relative inline-flex items-center justify-center mb-6">
            <div className="absolute w-20 h-20 rounded-full ai-pulse-active" />
            <div className="absolute w-16 h-16 rounded-full bg-primary-500/20 blur-xl" />
            <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/25">
              <MessageCircle size={26} className="text-white" strokeWidth={2} />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-textPrimary tracking-tight">{t('auth.title')}</h1>
          <p className="text-sm text-textSecondary mt-2 font-medium">{t('auth.subtitle')}</p>
        </div>

        {/* 表单卡片 */}
        <div className="w-full max-w-sm">
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-2xl shadow-black/30">
            {/* 登录/注册切换 */}
            <div className="flex bg-canvas rounded-lg p-1 mb-4 ring-1 ring-border/50">
              <button
                onClick={() => { setMode('login'); setError('') }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                  mode === 'login' ? 'bg-primary-600/20 text-primary-600 dark:text-primary-300 shadow-sm' : 'text-textMuted hover:text-textSecondary'
                }`}
              >
                {t('auth.login')}
              </button>
              <button
                onClick={() => { setMode('register'); setError('') }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                  mode === 'register' ? 'bg-primary-600/20 text-primary-600 dark:text-primary-300 shadow-sm' : 'text-textMuted hover:text-textSecondary'
                }`}
              >
                {t('auth.register')}
              </button>
            </div>

            {/* 登录方式选择（多方式时显示） */}
            {mode === 'login' && availableMethods.length > 1 && (
              <div className="flex gap-1.5 mb-4 flex-wrap">
                {availableMethods.map(m => (
                  <button
                    key={m}
                    onClick={() => { setLoginMethod(m); setError('') }}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                      loginMethod === m ? 'bg-primary-500/15 text-primary-500' : 'text-textMuted hover:text-textSecondary'
                    }`}
                  >
                    {t(METHOD_LABELS[m] || 'auth.methodDirect')}
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 用户名（direct 模式 + 注册模式） */}
              {(showDirectFields || mode === 'register') && (
                <div>
                  <label className="block text-xs font-medium text-textSecondary mb-1.5 ml-0.5">
                    {t('auth.username')}
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    minLength={2}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/60 focus:border-primary-500/40 text-sm transition-shadow"
                    placeholder={t('auth.usernamePlaceholder')}
                  />
                </div>
              )}

              {/* 密码（direct 模式） */}
              {showDirectFields && (
                <div>
                  <label className="block text-xs font-medium text-textSecondary mb-1.5 ml-0.5">
                    {t('auth.password')}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/60 focus:border-primary-500/40 text-sm transition-shadow"
                    placeholder={'••••••••（' + t('auth.passwordHint') + '）'}
                  />
                </div>
              )}

              {/* 邮箱（所有模式都显示，注册且强制验证时必填，否则选填） */}
              <div>
                <label className="block text-xs font-medium text-textSecondary mb-1.5 ml-0.5">
                  {t('auth.email')}
                  {mode === 'register' && !requireEmailVerification && (
                    <span className="text-textMuted ml-1">{t('auth.emailOptional')}</span>
                  )}
                </label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setCodeSent(false) }}
                    required={showEmailFields}
                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/60 focus:border-primary-500/40 text-sm transition-shadow"
                    placeholder={t('auth.emailPlaceholder')}
                  />
                </div>
              </div>

              {/* 发送验证码按钮（需要邮箱验证时显示） */}
              {(showEmailFields || (mode === 'register' && email)) && (
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={!email || sendCooldown > 0}
                  className="w-full py-2 text-sm font-medium rounded-xl border border-primary-500/30 text-primary-500 hover:bg-primary-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {sendCooldown > 0
                    ? t('auth.codeResendIn').replace('{seconds}', String(sendCooldown))
                    : codeSent ? t('auth.codeSent') : t('auth.sendCode')
                  }
                </button>
              )}

              {/* 验证码输入（发送过验证码后显示） */}
              {codeSent && (
                <div>
                  <label className="block text-xs font-medium text-textSecondary mb-1.5 ml-0.5">
                    {t('auth.codePlaceholder')}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value.slice(0, 6))}
                    required
                    maxLength={6}
                    minLength={6}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-primary-500/40 bg-canvas text-textPrimary text-center text-lg tracking-[0.3em] placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/60 transition-shadow"
                    placeholder="000000"
                  />
                </div>
              )}

              {/* 错误 */}
              {error && (
                <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2.5">
                  {error}
                </div>
              )}

              {/* 提交 */}
              <button
                type="submit"
                disabled={loading || (showDirectFields && (!username || !password)) || (loginMethod === 'email_code' && (!email || !code)) || (mode === 'register' && !username)}
                className="w-full py-2.5 bg-primary-500 hover:bg-primary-400 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-primary-500/20 hover:shadow-primary-400/30 mt-2"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('auth.verifying')}
                  </span>
                ) : mode === 'login' ? t('auth.enterPlatform') : t('auth.createAccount')}
              </button>
            </form>

            {mode === 'register' && hasExistingUsers === false && (
              <p className="text-xs text-textMuted mt-4 text-center leading-relaxed">
                {t('auth.firstUserAdminPrefix')}
                <span className="text-accent-400 font-medium">{t('auth.firstUserAdminHighlight')}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
