import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useT, useLang } from '../i18n/I18nContext'
import { api } from '../api/client'
import { AI_TYPE_LABEL } from '../constants'
import { fmtTokenNum } from '../utils/format'
import {
  User, Settings, LogOut, Shield, Tag,
  CreditCard, Gift, BarChart3, Bot, ChevronRight, Edit3,
  Loader2, Check, X, ArrowRight, Activity,
  FileText, HardDrive, Camera
} from 'lucide-react'
import AvatarCropModal from '../components/AvatarCropModal'

interface AgentBrief {
  id: number
  name: string
  state: string
  chat_model: string | null
  avatar_url: string | null
  ai_type: string
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
  const t = useT()
  const lang = useLang()
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
  const [cropFile, setCropFile] = useState<File | null>(null)

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
      setRedeemMsg(res.message || t('common.redeemSuccess'))
      setRedeemCode('')
      refreshUser?.()
    } catch (err: any) {
      setRedeemMsg(err.message || t('common.redeemFailed'))
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
  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { alert(t('error.avatarTooLarge')); return }
    setCropFile(file)
    // 重置 input 以便再次选择同一文件
    e.target.value = ''
  }

  const handleCropConfirm = async (blob: Blob) => {
    setCropFile(null)
    setAvatarUploading(true)
    try {
      const res = await api.upload('/user/avatar', new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
      setEditAvatarUrl(res.avatar_url)
    } catch (err: any) {
      alert(err.message || t('error.uploadFailed'))
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
      alert(err.message || t('error.saveFailed'))
    } finally { setEditSaving(false) }
  }

  if (!user) return null

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-6 space-y-5 pb-24 md:pb-6">
      {/* ====== 页面标题 ====== */}
      <h1 className="text-lg font-bold text-textPrimary">{t('me.title')}</h1>

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
                <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">{t('me.adminBadge')}</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-textMuted">
              <span className="flex items-center gap-1"><Bot size={12} /> AI {agents.length}</span>
              <span>{t('me.daysOnline')} {daysSince} {t('me.daysSuffix')}</span>
            </div>
            <button
              onClick={openEditProfile}
              className="mt-2 text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 flex items-center gap-1 transition-colors"
            >
              <Edit3 size={12} /> {t('me.editProfile')}
            </button>
          </div>
        </div>

        {/* 额度概览 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-border/60">
          {[
            { key: 'me.aiQuotaCard', value: user.ai_quota ?? 0, icon: Bot, color: 'text-primary-400', action: () => navigate('/agents') },
            { key: 'me.apiCreditCard', value: `${(user.api_credit ?? 0)} (≈${((user.api_credit ?? 0) * 10000).toLocaleString()} tokens)`, icon: CreditCard, color: 'text-mint-400', action: () => navigate('/me/usage'), poolName: user.assigned_pool_key_name },
            { key: 'me.bundleCreditCard', value: user.agent_bundle_credit ?? 0, icon: Tag, color: 'text-amber-400', action: () => navigate('/agents') },
            { key: 'me.fileQuotaCard', value: `${user.file_quota_mb ?? 100}MB`, icon: HardDrive, color: 'text-accent-400', action: () => navigate('/agents') },
          ].map(item => (
            <button
              key={item.key}
              onClick={item.action}
              className="bg-canvas rounded-xl p-3 text-center hover:bg-elevated transition-colors cursor-pointer w-full"
            >
              <item.icon size={16} className={`${item.color} mx-auto mb-1`} />
              <div className="text-sm font-semibold text-textPrimary">{item.value}</div>
              <div className="text-[10px] text-textMuted">{t(item.key)}{item.poolName ? ` · ${item.poolName}` : ''}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ====== 我的 AI ====== */}
      <div className="bg-surface rounded-2xl border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-textPrimary flex items-center gap-2">
            <Bot size={16} className="text-primary-400" /> {t('me.myAiSection')}
          </h3>
          <Link to="/agents" className="text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 flex items-center gap-1 transition-colors">
            {t('me.viewAll')} <ArrowRight size={12} />
          </Link>
        </div>
        {agents.length === 0 ? (
          <p className="text-sm text-textMuted py-3 text-center">{t('me.noAiLink')}<Link to="/agents" className="text-primary-400">{t('me.goCreate')}</Link></p>
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
                <div className="text-[10px] text-textMuted mt-0.5">{a.state === 'active' ? t('me.stateActive') : a.state === 'dnd' ? t('me.stateDnd') : t('me.stateOffline')}</div>
                {(AI_TYPE_LABEL[a.ai_type]) && (
                  <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full mt-1 font-medium ${AI_TYPE_LABEL[a.ai_type].cls}`}>
                    {t(AI_TYPE_LABEL[a.ai_type].key)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ====== API 用量 ====== */}
      <div className="bg-surface rounded-2xl border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-textPrimary flex items-center gap-2">
            <BarChart3 size={16} className="text-primary-400" /> {t('me.apiUsage30d')}
          </h3>
          <Link to="/me/usage" className="text-xs text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 flex items-center gap-1 transition-colors">
            {t('me.viewDetails')} <ArrowRight size={12} />
          </Link>
        </div>
        {usageLoading ? (
          <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-textMuted" /></div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { key: 'me.totalTokens', value: fmtTokenNum(totalTokens, lang), icon: Activity, color: 'text-primary-400' },
              { key: 'me.calls', value: totalCalls, icon: BarChart3, color: 'text-mint-400' },
              { key: 'me.cacheHitRate', value: `${cacheRate}%`, icon: FileText, color: 'text-amber-400' },
              { key: 'me.thinkingTokens', value: fmtTokenNum(totalReasoning, lang), icon: Activity, color: 'text-accent-400' },
            ].map(item => (
              <div key={item.key} className="bg-canvas rounded-xl p-3 text-center">
                <item.icon size={16} className={`${item.color} mx-auto mb-1`} />
                <div className="text-sm font-semibold text-textPrimary">{item.value}</div>
                <div className="text-[10px] text-textMuted">{t(item.key)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ====== 存储概览 ====== */}
      <div className="bg-surface rounded-2xl border border-border p-5">
        <h3 className="text-sm font-semibold text-textPrimary mb-3 flex items-center gap-2">
          <HardDrive size={16} className="text-primary-400" /> {t('me.storageSection')}
        </h3>
        {storageLoading ? (
          <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-textMuted" /></div>
        ) : storage ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-textMuted">
              <span>{t('me.used')} {storage.total_used >= 1048576 ? `${(storage.total_used / 1048576).toFixed(1)}MB` : `${(storage.total_used / 1024).toFixed(0)}KB`}</span>
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
              <span>{storage.total_files} {t('me.fileCountSuffix')}</span>
              <span>{t('me.quota')} {storage.quota_mb}MB</span>
            </div>
            {storage.usage_percent > 90 && (
              <p className="text-xs text-rose-400">{t('me.storageWarning')}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-textMuted py-3 text-center">{t('me.noStorageData')}</p>
        )}
      </div>

      {/* ====== 兑换码 ====== */}
      <div id="redeem-section" className="bg-surface rounded-2xl border border-border p-5">
        <h3 className="text-sm font-semibold text-textPrimary mb-3 flex items-center gap-2">
          <Gift size={16} className="text-primary-400" /> {t('me.redeemSection')}
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={redeemCode}
            onChange={e => setRedeemCode(e.target.value)}
            placeholder={t('me.redeemPlaceholder')}
            className="flex-1 px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 font-mono"
          />
          <button
            onClick={handleRedeem}
            disabled={redeeming || !redeemCode.trim()}
            className="px-4 py-2 rounded-xl bg-primary-500 text-white hover:bg-primary-400 disabled:opacity-40 text-sm font-medium transition-colors"
          >
            {redeeming ? <Loader2 size={14} className="animate-spin" /> : t('me.redeemButton')}
          </button>
        </div>
        {redeemMsg && (
          <p className={`text-xs mt-2 ${redeemMsg.includes('失败') || redeemMsg.includes('无效') ? 'text-rose-400' : 'text-mint-400'}`}>
            {redeemMsg}
          </p>
        )}
      </div>

      {/* ====== 管理员入口 ====== */}
      {user.role === 'admin' && (
        <div className="bg-surface rounded-2xl border border-border">
          <Link
            to="/admin"
            className="flex items-center gap-3 px-5 py-3 hover:bg-elevated transition-colors"
          >
            <Shield size={16} className="text-amber-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-textPrimary">{t('me.managementSection')}</div>
              <div className="text-xs text-textMuted">{t('me.managementDesc')}</div>
            </div>
            <ChevronRight size={14} className="text-textMuted shrink-0" />
          </Link>
        </div>
      )}

      {/* ====== 设置入口 ====== */}
      <Link
        to="/settings"
        className="bg-surface rounded-2xl border border-border p-5 flex items-center gap-3 hover:bg-elevated transition-colors"
      >
        <Settings size={18} className="text-textMuted shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-textPrimary">{t('me.settings')}</div>
        </div>
        <ChevronRight size={14} className="text-textMuted shrink-0" />
      </Link>

      {/* ====== 退出登录 ====== */}
      <button
        onClick={logout}
        className="w-full py-3 rounded-xl border border-rose-500/20 text-rose-400 hover:bg-rose-500/5 text-sm font-medium transition-colors flex items-center justify-center gap-2"
      >
        <LogOut size={14} /> {t('me.logout')}
      </button>

      {/* ====== 编辑资料弹窗 ====== */}
      {showEditProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowEditProfile(false)}>
          <div
            className="bg-surface rounded-2xl border border-border w-full max-w-sm mx-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-textPrimary">{t('me.editProfileModalTitle')}</h3>
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
                  {avatarUploading ? t('me.uploadingAvatar') : t('me.changeAvatar')}
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} disabled={avatarUploading} />
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium text-textSecondary mb-1">{t('me.usernameField')}</label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={e => setEditUsername(e.target.value)}
                  placeholder={user.username}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-textSecondary mb-1">{t('me.bioField')}</label>
                <textarea
                  value={editBio}
                  onChange={e => setEditBio(e.target.value)}
                  placeholder={t('me.bioPlaceholder')}
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-textSecondary mb-1">{t('me.passwordField')}</label>
                <input
                  type="password"
                  value={editPassword}
                  onChange={e => setEditPassword(e.target.value)}
                  placeholder={t('me.passwordMinHint')}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
              </div>
              <button
                onClick={handleSaveProfile}
                disabled={editSaving}
                className="w-full py-2.5 rounded-xl bg-primary-500 text-white hover:bg-primary-400 disabled:opacity-40 text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {editSaving ? t('me.savingProfile') : t('me.saveButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 头像裁剪弹窗 */}
      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropFile(null)}
        />
      )}
    </div>
  )
}
