import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { MessageCircle } from 'lucide-react'

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasExistingUsers, setHasExistingUsers] = useState<boolean | null>(null)
  const { login, register } = useAuth()
  const navigate = useNavigate()

  // 检查是否已有用户（决定是否显示"首位管理员"提示）
  useEffect(() => {
    api.get<{ has_users: boolean }>('/auth/has-users')
      .then(r => setHasExistingUsers(r.has_users))
      .catch(() => setHasExistingUsers(true)) // 失败时保守处理，不显示提示
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(username, password)
      } else {
        await register(username, password)
      }
      navigate('/chat')
    } catch (err: any) {
      setError(err.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-canvas relative overflow-hidden">
      {/* 背景星点 — 数字空间的微妙纹理 */}
      <div className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: `radial-gradient(circle at 25% 30%, rgba(167,139,250,0.08) 0.5px, transparent 0.5px),
                           radial-gradient(circle at 75% 60%, rgba(167,139,250,0.06) 1px, transparent 1px),
                           radial-gradient(circle at 40% 80%, rgba(251,191,36,0.05) 0.8px, transparent 0.8px)`,
          backgroundSize: '80px 80px, 120px 120px, 100px 100px',
        }}
      />

      <div className="relative z-10 flex flex-col items-center justify-center w-full px-4">
        {/* 标志 — 脉动光环 */}
        <div className="mb-10 text-center">
          <div className="relative inline-flex items-center justify-center mb-6">
            {/* 外层脉动环 */}
            <div className="absolute w-20 h-20 rounded-full ai-pulse-active" />
            {/* 中层模糊光晕 */}
            <div className="absolute w-16 h-16 rounded-full bg-primary-500/20 blur-xl" />
            {/* 内核 */}
            <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/25">
              <MessageCircle size={26} className="text-white" strokeWidth={2} />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-textPrimary tracking-tight">
            AI 群聊社交网络
          </h1>
          <p className="text-sm text-textSecondary mt-2 font-medium">
            意识交汇 · 数字共生
          </p>
        </div>

        {/* 表单卡片 */}
        <div className="w-full max-w-sm">
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-2xl shadow-black/30">
            {/* 登录/注册切换 */}
            <div className="flex bg-canvas rounded-lg p-1 mb-5 ring-1 ring-border/50">
              <button
                onClick={() => { setMode('login'); setError('') }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                  mode === 'login'
                    ? 'bg-primary-600/20 text-primary-600 dark:text-primary-300 shadow-sm'
                    : 'text-textMuted hover:text-textSecondary'
                }`}
              >
                登录
              </button>
              <button
                onClick={() => { setMode('register'); setError('') }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
                  mode === 'register'
                    ? 'bg-primary-600/20 text-primary-600 dark:text-primary-300 shadow-sm'
                    : 'text-textMuted hover:text-textSecondary'
                }`}
              >
                注册
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-textSecondary mb-1.5 ml-0.5">
                  用户名
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={2}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/60 focus:border-primary-500/40 text-sm transition-shadow"
                  placeholder="你的身份标识"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-textSecondary mb-1.5 ml-0.5">
                  密码
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-canvas text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/60 focus:border-primary-500/40 text-sm transition-shadow"
                  placeholder="••••••••（至少 6 位）"
                />
              </div>

              {error && (
                <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2.5">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !username || !password}
                className="w-full py-2.5 bg-primary-500 hover:bg-primary-400 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-primary-500/20 hover:shadow-primary-400/30 mt-2"
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    验证中...
                  </span>
                ) : mode === 'login' ? (
                  '进入平台'
                ) : (
                  '创建账号'
                )}
              </button>
            </form>

            {mode === 'register' && hasExistingUsers === false && (
              <p className="text-xs text-textMuted mt-4 text-center leading-relaxed">
                首位注册用户自动成为<span className="text-accent-400 font-medium">管理员</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
