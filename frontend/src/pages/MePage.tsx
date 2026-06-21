import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import {
  User, Settings, LogOut, Shield, Globe, Tag,
  CreditCard, Gift, BarChart3, Bot, ChevronRight, Edit3,
  Loader2, Check, X, ArrowRight, Activity,
  FileText, HardDrive, Camera
} from 'lucide-react'

interface AgentBrief {
  id: number
  name: string
  state: string
  chat_model: string | null
  avatar_url: string | null
}

interface UsageOverview {
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

export default function MePage() {
  const { user, logout, refreshUser } = useAuth()
  const navigate = useNavigate()

  const [agents, setAgents] = useState<AgentBrief[]>([])
  const [usage, setUsage] = useState<UsageOverview[]>([])
  const [usageLoading, setUsageLoading] = useState(true)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemMsg, setRedeemMsg] = useState('')
  const [redeeming, setRedeeming] = useState(false)

  // 存储概览
  const [storage, setStorage] = useState<{ total_used: number; total_files: number; quota_mb: number; usage_percent: number } | null>(null)
  const [storageLoading, setStorageLoading] = useState(true)

  // 编辑资料弹窗
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [editUsername, setEditUsername] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editBio, setEditBio] = useState('')
  const [editAvatarUrl, setEditAvatarUrl] = useState('')
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => {
    // 加载我的 AI 列表
    api.get<AgentBrief[]>('/agents').then(r => {
      setAgents((Array.isArray(r) ? r : []).slice(0, 3))
    }).catch(() => {})

    // 加载用量概览
    setUsageLoading(true)
    api.get<UsageOverview[]>('/conversation-log/usage/overview?days=30').then(r => {
      setUsage(Array.isArray(r) ? r : [])
    }).catch(() => {}).finally(() => setUsageLoading(false))

    // 加载存储概览
    setStorageLoading(true)
    api.get<{ total_used: number; total_files: number; quota_mb: number; usage_percent: number }>('/user/storage').then(r => {
      setStorage(r)
    }).catch(() => {}).finally(() => setStorageLoading(false))
  }, [])

  // 汇总
  const totalTokens = usage.reduce((s, u) => s + (u.total_tokens || 0), 0)
  const totalCalls = usage.reduce((s, u) => s + (u.total_calls || 0), 0)
  const totalReasoning = usage.reduce((s, u) => s + (u.reasoning_tokens || 0), 0)
  const totalCached = usage.reduce((s, u) => s + (u.cached_tokens || 0), 0)
  const cacheRate = totalTokens + totalCached > 0 ? Math.round(totalCached / (totalTokens + totalCached) * 100) : 0

  // 上线天数
  const daysSince = user?.created_at
    ? Math.max(1, Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000))
    : 1

  // ── 兑换码 ──
  const handleRedeem = async () => {
    if (!redeemCode.trim()) return
    setRedeeming(true)
    setRedeemMsg('')
    try {
      const res = await api.post<{ message: string }>('/redeem', { code: redeemCode.trim().toUpperCase() })
      setRedeemMsg(res.message || '兑换成功')
      setRedeemCode('')
      refreshUser?.()
    } catch (err: any) {
      setRedeemMsg(err.message || '兑换失败')
    } finally { setRedeeming(false) }
  }

  // ── 编辑资料 ──
  const openEditProfile = () => {
    setEditUsername(user?.username || '')
    setEditPassword('')
    setEditBio(user?.bio || '')
    setEditAvatarUrl(user?.avatar_url || '')
    setShowEditProfile(true)
  }
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    try {
      const res = await api.upload('/files/upload', file)
      setEditAvatarUrl(`/api/files/download/${res.file_id}`)
    } catch (err: any) {
      alert(err.message || '上传失败')
    } finally { setAvatarUploading(false) }
  }
  const handleSaveProfile = async () => {
    setEditSaving(true)
    try {
      const body: any = {}
      if (editUsername && editUsername !== user?.username) body.username = editUsername
      if (editPassword) body.password = editPassword
      if (editBio !== (user?.bio || '')) body.bio = editBio
      if (editAvatarUrl !== (user?.avatar_url || '')) body.avatar_url = editAvatarUrl
      if (Object.keys(body).length > 0) {
        await api.put('/user/settings', body)
      }
      await refreshUser?.()
      setShowEditProfile(false)
    } catch (err: any) {
      alert(err.message || '保存失败')
    } finally { setEditSaving(false) }
  }

  if (!user) return null

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-5 pb-24 md:pb-6">
      {/* ====== 个人资料卡 ====== */}
      <div className="bg-surface rounded-2xl border border-border p-5">
        <div className="flex items-center gap-4">
          {/* 头像 */}
          <div className="shrink-0">
            {user.avatar_url ? (
              <img src={user.avatar_url} className="w-16 h-16 rounded-full object-cover border-2 border-primary-400/30" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-primary-500/15 flex items-center justify-center">
                <User size={28} className="text-primary-400" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-textPrimary truncate">{user.username}</h2>
              {user.role === 'admin' && (
                <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">管理员</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-textMuted">
              <span className="flex items-center gap-1"><Bot size={12} /> AI {agents.length}</span>
              <span>加入 {daysSince} 天</span>
            </div>
            <button
              onClick={openEditProfile}
              className="mt-2 text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 flex items-center gap-1 transition-colors"
            >
              <Edit3 size={12} /> 编辑资料
            </button>
          </div>
        </div>

        {/* 额度概览 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-border/60">
          {[
            { label: 'AI 创建', value: user.ai_quota ?? 0, icon: Bot, color: 'text-primary-400', action: () => navigate('/agents') },
            { label: '通用额度', value: user.api_credit ?? 0, icon: CreditCard, color: 'text-mint-400', action: () => navigate('/me/usage') },
            { label: '包断额度', value: user.agent_bundle_credit ?? 0, icon: Tag, color: 'text-amber-400', action: () => navigate('/agents') },
            { label: '文件配额', value: `${user.file_quota_mb ?? 100}MB`, icon: HardDrive, color: 'text-accent-400', action: () => navigate('/agents') },
          ].map(item => (
            <button
              key={item.label}
              onClick={item.action}
              className="bg-canvas rounded-xl p-3 text-center hover:bg-elevated transition-colors cursor-pointer w-full"
            >
              <item.icon size={16} className={`${item.color} mx-auto mb-1`} />
              <div className="text-sm font-semibold text-textPrimary">{item.value}</div>
              <div className="text-[10px] text-textMuted">{item.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ====== 我的 AI ====== */}
      <div className="bg-surface rounded-2xl border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-textPrimary flex items-center gap-2">
            <Bot size={16} className="text-primary-400" /> 我的 AI
          </h3>
          <Link to="/agents" className="text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 flex items-center gap-1 transition-colors">
            查看全部 <ArrowRight size={12} />
          </Link>
        </div>
        {agents.length === 0 ? (
          <p className="text-sm text-textMuted py-3 text-center">还没有 AI，<Link to="/agents" className="text-primary-400">去创建 →</Link></p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {agents.map(a => (
              <Link
                key={a.id}
                to={`/agents/${a.id}`}
                className="shrink-0 w-28 bg-canvas rounded-xl p-3 border border-border hover:border-primary-400/30 transition-colors text-center"
              >
                <div className="w-10 h-10 rounded-full bg-primary-500/10 flex items-center justify-center mx-auto mb-1.5">
                  {a.avatar_url ? (
                    <img src={a.avatar_url} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <Bot size={18} className="text-primary-400" />
                  )}
                </div>
                <div className="text-xs font-medium text-textPrimary truncate">{a.name}</div>
                <div className="text-[10px] text-textMuted mt-0.5">{a.state === 'active' ? '在线' : a.state === 'dnd' ? '勿扰' : '离线'}</div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ====== API 用量 ====== */}
      <div className="bg-surface rounded-2xl border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-textPrimary flex items-center gap-2">
            <BarChart3 size={16} className="text-primary-400" /> API 用量（近30天）
          </h3>
          <Link to="/me/usage" className="text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 flex items-center gap-1 transition-colors">
            查看详细 <ArrowRight size={12} />
          </Link>
        </div>
        {usageLoading ? (
          <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-textMuted" /></div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: '总 Token', value: totalTokens >= 10000 ? `${(totalTokens/10000).toFixed(1)}万` : totalTokens.toLocaleString(), icon: Activity, color: 'text-primary-400' },
              { label: '调用次数', value: totalCalls, icon: BarChart3, color: 'text-mint-400' },
              { label: '缓存命中率', value: `${cacheRate}%`, icon: FileText, color: 'text-amber-400' },
              { label: '思考 Token', value: totalReasoning >= 10000 ? `${(totalReasoning/10000).toFixed(1)}万` : totalReasoning.toLocaleString(), icon: Activity, color: 'text-accent-400' },
            ].map(item => (
              <div key={item.label} className="bg-canvas rounded-xl p-3 text-center">
                <item.icon size={16} className={`${item.color} mx-auto mb-1`} />
                <div className="text-sm font-semibold text-textPrimary">{item.value}</div>
                <div className="text-[10px] text-textMuted">{item.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ====== 存储概览 ====== */}
      <div className="bg-surface rounded-2xl border border-border p-5">
        <h3 className="text-sm font-semibold text-textPrimary mb-3 flex items-center gap-2">
          <HardDrive size={16} className="text-primary-400" /> 存储空间
        </h3>
        {storageLoading ? (
          <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-textMuted" /></div>
        ) : storage ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-textMuted">
              <span>已用 {storage.total_used >= 1048576 ? `${(storage.total_used / 1048576).toFixed(1)}MB` : `${(storage.total_used / 1024).toFixed(0)}KB`}</span>
              <span className={storage.usage_percent > 90 ? 'text-rose-400 font-medium' : storage.usage_percent > 70 ? 'text-amber-400 font-medium' : ''}>
                {storage.usage_percent}%
              </span>
            </div>
            <div className="w-full h-2 bg-canvas rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  storage.usage_percent > 90 ? 'bg-rose-400' : storage.usage_percent > 70 ? 'bg-amber-400' : 'bg-primary-400'
                }`}
                style={{ width: `${Math.min(storage.usage_percent, 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-textMuted">
              <span>{storage.total_files} 个文件</span>
              <span>配额 {storage.quota_mb}MB</span>
            </div>
            {storage.usage_percent > 90 && (
              <p className="text-xs text-rose-400">⚠️ 存储空间即将用尽，请清理文件或兑换更多配额</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-textMuted py-3 text-center">暂无存储数据</p>
        )}
      </div>

      {/* ====== 兑换码 ====== */}
      <div id="redeem-section" className="bg-surface rounded-2xl border border-border p-5">
        <h3 className="text-sm font-semibold text-textPrimary mb-3 flex items-center gap-2">
          <Gift size={16} className="text-primary-400" /> 兑换码
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={redeemCode}
            onChange={e => setRedeemCode(e.target.value)}
            placeholder="RC-XXXXXXXXXXXXXXXX"
            className="flex-1 px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 font-mono"
          />
          <button
            onClick={handleRedeem}
            disabled={redeeming || !redeemCode.trim()}
            className="px-4 py-2 rounded-xl bg-primary-500 text-white hover:bg-primary-400 disabled:opacity-40 text-sm font-medium transition-colors"
          >
            {redeeming ? <Loader2 size={14} className="animate-spin" /> : '兑换'}
          </button>
        </div>
        {redeemMsg && (
          <p className={`text-xs mt-2 ${redeemMsg.includes('失败') || redeemMsg.includes('无效') ? 'text-rose-400' : 'text-mint-400'}`}>
            {redeemMsg}
          </p>
        )}
      </div>

      {/* ====== 设置入口 ====== */}
      <div className="bg-surface rounded-2xl border border-border divide-y divide-border/60">
        {[
          { icon: Settings, label: 'API 配置', desc: 'Base URL / API Key / 测试连接', path: '/settings' },
          { icon: Settings, label: '外观与通知', desc: '主题 / 通知开关 / 聊天样式', path: '/settings' },
          { icon: Globe, label: '语言与时区', desc: '中文/English · 时区设置', path: '/settings' },
        ].map(item => (
          <Link
            key={item.label}
            to={item.path}
            className="flex items-center gap-3 px-5 py-3 hover:bg-elevated transition-colors"
          >
            <item.icon size={16} className="text-textMuted shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-textPrimary">{item.label}</div>
              <div className="text-xs text-textMuted">{item.desc}</div>
            </div>
            <ChevronRight size={14} className="text-textMuted shrink-0" />
          </Link>
        ))}
      </div>

      {/* ====== 管理员入口 ====== */}
      {user.role === 'admin' && (
        <div className="bg-surface rounded-2xl border border-border divide-y divide-border/60">
          {[
            { icon: Shield, label: '管理面板', desc: '用户/AI/群聊/兑换码/用量分析', path: '/admin' },
            { icon: Globe, label: '联邦管理', desc: '联邦对等端 / 注册表', path: '/admin' },
          ].map(item => (
            <Link
              key={item.label}
              to={item.path}
              className="flex items-center gap-3 px-5 py-3 hover:bg-elevated transition-colors"
            >
              <item.icon size={16} className="text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-textPrimary">{item.label}</div>
                <div className="text-xs text-textMuted">{item.desc}</div>
              </div>
              <ChevronRight size={14} className="text-textMuted shrink-0" />
            </Link>
          ))}
        </div>
      )}

      {/* ====== 退出登录 ====== */}
      <button
        onClick={logout}
        className="w-full py-3 rounded-xl border border-rose-500/20 text-rose-400 hover:bg-rose-500/5 text-sm font-medium transition-colors flex items-center justify-center gap-2"
      >
        <LogOut size={14} /> 退出登录
      </button>

      {/* ====== 编辑资料弹窗 ====== */}
      {showEditProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowEditProfile(false)}>
          <div
            className="bg-surface rounded-2xl border border-border w-full max-w-sm mx-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-textPrimary">编辑资料</h3>
              <button onClick={() => setShowEditProfile(false)} className="p-1 rounded-lg hover:bg-elevated text-textMuted">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* 头像 */}
              <div className="flex flex-col items-center gap-2">
                <div className="w-20 h-20 rounded-full bg-primary-500/10 flex items-center justify-center overflow-hidden border-2 border-border">
                  {editAvatarUrl ? (
                    <img src={editAvatarUrl} className="w-full h-full object-cover" />
                  ) : (
                    <User size={32} className="text-primary-400" />
                  )}
                </div>
                <label className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-500 cursor-pointer transition-colors">
                  <Camera size={12} />
                  {avatarUploading ? '上传中...' : '更换头像'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={avatarUploading} />
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-textSecondary mb-1">用户名</label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={e => setEditUsername(e.target.value)}
                  placeholder={user.username}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-textSecondary mb-1">简介</label>
                <textarea
                  value={editBio}
                  onChange={e => setEditBio(e.target.value)}
                  placeholder="写一句话介绍自己..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-textSecondary mb-1">新密码（留空不修改）</label>
                <input
                  type="password"
                  value={editPassword}
                  onChange={e => setEditPassword(e.target.value)}
                  placeholder="至少 6 位"
                  className="w-full px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>
              <button
                onClick={handleSaveProfile}
                disabled={editSaving}
                className="w-full py-2.5 rounded-xl bg-primary-500 text-white hover:bg-primary-400 disabled:opacity-40 text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {editSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
