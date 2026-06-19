import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { Globe, Link, Plus, Trash2, RefreshCw, Power, Shield } from 'lucide-react'

interface InstanceInfo {
  instance_id: string
  public_id: string | null
  display_name: string
  public_url: string
  github_token_configured: boolean
  created_at: string | null
  updated_at: string | null
}

interface Peer {
  id: number
  peer_public_id: string
  display_name: string
  remote_url: string
  is_enabled: boolean
  connection_state: string
  last_connected_at: string | null
  created_at: string | null
  updated_at: string | null
}

interface GroupShare {
  id: number
  group_id: number
  peer_id: number
  peer_public_id: string
  peer_display_name: string
  is_enabled: boolean
  remote_group_id: number | null
  share_direction: string
  created_at: string | null
}

export default function FederationTab() {
  const [instance, setInstance] = useState<InstanceInfo | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 注册状态机: idle → confirm(风险告知) → loading → success | error
  type RegisterState = 'idle' | 'confirm' | 'loading' | 'success' | 'error'
  const [registerState, setRegisterState] = useState<RegisterState>('idle')
  const [registerResult, setRegisterResult] = useState('')
  const [registerErrorCode, setRegisterErrorCode] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [tokenSaving, setTokenSaving] = useState(false)
  const [dialogToken, setDialogToken] = useState('')  // 弹窗内的临时 Token 输入
  const [quickToken, setQuickToken] = useState('')    // TOKEN_MISSING 时行内快速输入

  // 表单状态
  const [showAddPeer, setShowAddPeer] = useState(false)
  const [newPeer, setNewPeer] = useState({ display_name: '', peer_public_id: '', remote_url: '', shared_secret: '' })
  const [editInstance, setEditInstance] = useState(false)
  const [instanceForm, setInstanceForm] = useState({ display_name: '', public_url: '', public_id: '' })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [inst, peerList] = await Promise.all([
        api.get<InstanceInfo>('/admin/federation/instance'),
        api.get<Peer[]>('/admin/federation/peers'),
      ])
      setInstance(inst)
      setPeers(peerList)
      setInstanceForm({ display_name: inst.display_name, public_url: inst.public_url, public_id: inst.public_id || '' })
    } catch (e: any) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveInstance = async () => {
    await api.put('/admin/federation/instance', instanceForm)
    setEditInstance(false)
    await loadData()
  }

  const handleAddPeer = async () => {
    if (!newPeer.peer_public_id || !newPeer.remote_url || !newPeer.shared_secret) return
    await api.post('/admin/federation/peers', newPeer)
    setNewPeer({ display_name: '', peer_public_id: '', remote_url: '', shared_secret: '' })
    setShowAddPeer(false)
    await loadData()
  }

  const handleDeletePeer = async (id: number) => {
    if (!confirm('确定移除此对等端？相关群聊共享也将被删除。')) return
    await api.delete(`/admin/federation/peers/${id}`)
    await loadData()
  }

  const handleConnect = async (id: number) => {
    await api.post(`/admin/federation/peers/${id}/connect`)
    await loadData()
  }

  const handleDisconnect = async (id: number) => {
    await api.post(`/admin/federation/peers/${id}/disconnect`)
    await loadData()
  }

  const handleRegister = async () => {
    // 首次点击 → 显示风险告知弹窗
    if (registerState !== 'confirm') {
      setRegisterState('confirm')
      return
    }

    // 再次点击（已确认风险）→ 执行注册
    setRegisterState('loading')

    // 如果弹窗中填了 Token 且尚未配置，先保存
    const needSaveToken = dialogToken.trim() && !instance?.github_token_configured
    if (needSaveToken) {
      setRegisterResult('🔑 正在保存 Token...')
      try {
        await api.put('/admin/federation/instance/github-token', { token: dialogToken.trim() })
        setDialogToken('')
        await loadData() // 刷新 github_token_configured
      } catch (e: any) {
        setRegisterState('error')
        setRegisterResult(e?.response?.data?.detail || 'Token 保存失败')
        return
      }
    }

    setRegisterResult('🔍 正在验证公网 URL 可达性与身份匹配...')
    setRegisterErrorCode('')

    try {
      const result = await api.post<{
        success: boolean
        message: string
        error_code?: string
        existing_entry?: { display_name: string; registered_at: string }
      }>('/admin/federation/instance/register')

      if (result.success) {
        setRegisterState('success')
        setRegisterResult(result.message)
        await loadData()
      } else {
        setRegisterState('error')
        setRegisterErrorCode(result.error_code || '')
        setRegisterResult(result.message || '注册失败')
      }
    } catch (e: any) {
      setRegisterState('error')
      const detail = e?.response?.data?.detail
      if (typeof detail === 'object') {
        setRegisterErrorCode(detail.error_code || '')
        setRegisterResult(detail.message || JSON.stringify(detail))
      } else {
        setRegisterResult(typeof detail === 'string' ? detail : (e?.message || '注册失败'))
      }
    }
  }

  const handleQuickSaveToken = async () => {
    // 快速保存 Token 并重试注册（TOKEN_MISSING 错误恢复）
    if (!quickToken.trim()) return
    setRegisterState('loading')
    setRegisterResult('🔑 正在保存 Token...')
    try {
      await api.put('/admin/federation/instance/github-token', { token: quickToken.trim() })
      setQuickToken('')
      await loadData()
      // 保存成功后自动重试注册
      setRegisterResult('🔍 正在验证公网 URL 可达性与身份匹配...')
      const result = await api.post<{
        success: boolean; message: string; error_code?: string
      }>('/admin/federation/instance/register')
      if (result.success) {
        setRegisterState('success')
        setRegisterResult(result.message)
        await loadData()
      } else {
        setRegisterState('error')
        setRegisterErrorCode(result.error_code || '')
        setRegisterResult(result.message || '注册失败')
      }
    } catch (e: any) {
      setRegisterState('error')
      const detail = e?.response?.data?.detail
      if (typeof detail === 'object') {
        setRegisterErrorCode(detail.error_code || '')
        setRegisterResult(detail.message || JSON.stringify(detail))
      } else {
        setRegisterResult(typeof detail === 'string' ? detail : (e?.message || '保存/注册失败'))
      }
    }
  }

  const handleRegenerateId = async () => {
    if (!confirm('确认重新生成公网 ID？旧 ID 将作废。如果已注册到 GitHub，需要重新注册。')) return
    try {
      const result = await api.post<{ success: boolean; public_id: string }>('/admin/federation/instance/regenerate-id')
      if (result.public_id) {
        setInstanceForm({ ...instanceForm, public_id: result.public_id })
        setRegisterResult('')
        await loadData()
      }
    } catch (e: any) {
      alert(e?.response?.data?.detail || '生成失败')
    }
  }

  const handleSaveToken = async () => {
    if (!githubToken.trim()) {
      setRegisterResult('请先填入 GitHub Token')
      return
    }
    setTokenSaving(true)
    try {
      await api.put('/admin/federation/instance/github-token', { token: githubToken.trim() })
      setGithubToken('')
      setRegisterResult('✅ GitHub Token 已加密保存')
      await loadData()
    } catch (e: any) {
      setRegisterResult(e?.response?.data?.detail || '保存失败')
    } finally {
      setTokenSaving(false)
    }
  }

  const stateBadge = (state: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      connected: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: '已连接' },
      connecting: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: '连接中' },
      disconnected: { bg: 'bg-slate-500/10', text: 'text-slate-400', label: '未连接' },
      failed: { bg: 'bg-rose-500/10', text: 'text-rose-400', label: '失败' },
    }
    const s = map[state] || map.disconnected
    return <span className={`text-xs px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>{s.label}</span>
  }

  if (loading) return <div className="text-textMuted text-sm p-4">加载中...</div>
  if (error) return <div className="text-rose-400 text-sm p-4">{error}</div>

  const isRegistering = registerState === 'loading'

  return (
    <div className="space-y-6">
      {/* 风险告知弹窗 */}
      {registerState === 'confirm' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setRegisterState('idle'); setDialogToken('') }}>
          <div className="bg-surface border border-border rounded-xl p-6 max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-textPrimary mb-3">⚠️ 注册公网 ID 须知</h3>
            <div className="text-sm text-textSecondary space-y-2 mb-5">
              <p>将公网 ID 注册到 GitHub 注册表后：</p>
              <ul className="list-disc pl-5 space-y-1 text-xs">
                <li>你的 <strong className="text-textPrimary">公网 ID、显示名称、公网 URL</strong> 将公开可见</li>
                <li>其他 AIsChat 实例可以通过注册表发现并尝试连接你的实例</li>
                <li>连接请求需要 <strong className="text-textPrimary">双方配置共享密钥</strong> 才能成功握手</li>
                <li>你可以随时在注册表中 <strong className="text-textPrimary">更新或删除</strong> 自己的条目</li>
                <li className="text-amber-400">请确保公网 URL 指向的是你自己的实例，不要冒用他人地址</li>
              </ul>
              <p className="text-xs text-textMuted mt-2">注册前系统会验证你的公网 URL 确实指向运行中的 AIsChat 实例。</p>
            </div>
            {/* 若未配置 Token，直接在弹窗中输入 */}
            {!instance?.github_token_configured && (
              <div className="mb-4 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                <label className="text-xs text-textMuted">
                  GitHub Token{' '}
                  <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:text-primary-300">
                    获取 →
                  </a>
                </label>
                <p className="text-[10px] text-textMuted mb-1.5">
                  需要 Token 才能写入注册表。点击链接 → Generate new token (classic) → 勾选 <strong>repo</strong>
                </p>
                <input
                  type="password"
                  value={dialogToken}
                  onChange={e => setDialogToken(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm bg-canvas border border-border rounded-lg text-textPrimary font-mono"
                  placeholder="ghp_xxxxxxxxxxxxxxxx"
                />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setRegisterState('idle'); setDialogToken('') }}
                className="px-4 py-1.5 text-xs bg-canvas border border-border text-textSecondary rounded-lg hover:bg-border/20 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleRegister}
                disabled={!instance?.github_token_configured && !dialogToken.trim()}
                className={`px-4 py-1.5 text-xs rounded-lg transition-colors ${
                  !instance?.github_token_configured && !dialogToken.trim()
                    ? 'bg-canvas text-textMuted cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {!instance?.github_token_configured ? '保存 Token 并注册' : '我已知晓，继续注册'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 实例身份 */}
      <section className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-textPrimary flex items-center gap-2">
            <Shield size={16} /> 实例身份
          </h2>
          <button
            onClick={() => setEditInstance(!editInstance)}
            className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
          >
            {editInstance ? '取消' : '编辑'}
          </button>
        </div>

        {editInstance ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-textMuted">显示名称</label>
              <input
                value={instanceForm.display_name}
                onChange={e => setInstanceForm({ ...instanceForm, display_name: e.target.value })}
                className="w-full mt-1 px-3 py-1.5 text-sm bg-canvas border border-border rounded-lg text-textPrimary"
                placeholder="我的实例"
              />
            </div>
            <div>
              <label className="text-xs text-textMuted">
                公网地址（输入域名或 IP，自动拼接 <code className="text-[10px] bg-canvas px-1 rounded">/federation/ws</code>）
              </label>
              <div className="flex items-stretch mt-1">
                <select
                  value={(instanceForm.public_url.match(/^(wss?):\/\//)?.[1]) || 'wss'}
                  onChange={e => {
                    const host = instanceForm.public_url.replace(/^wss?:\/\//, '').replace(/\/federation\/ws$/, '')
                    setInstanceForm({ ...instanceForm, public_url: `${e.target.value}://${host}/federation/ws` })
                  }}
                  className="w-20 px-2 text-sm bg-canvas border border-border rounded-l-lg text-textPrimary shrink-0"
                >
                  <option value="wss">wss://</option>
                  <option value="ws">ws://</option>
                </select>
                <input
                  value={(() => {
                    const m = instanceForm.public_url.match(/^(wss?):\/\/(.+?)\/federation\/ws$/)
                    return m ? m[2] : instanceForm.public_url.replace(/^wss?:\/\//, '')
                  })()}
                  onChange={e => {
                    const proto = (instanceForm.public_url.match(/^(wss?):\/\//)?.[1]) || 'wss'
                    const host = e.target.value.replace(/\/$/, '')
                    setInstanceForm({ ...instanceForm, public_url: `${proto}://${host}/federation/ws` })
                  }}
                  className="flex-1 px-3 py-1.5 text-sm bg-canvas border border-border border-x-0 text-textPrimary font-mono"
                  placeholder="aischat.example.com"
                />
                <span className="inline-flex items-center px-2 text-xs text-textMuted bg-canvas border border-border rounded-r-lg shrink-0 font-mono">
                  /federation/ws
                </span>
              </div>
            </div>
            <div>
              <label className="text-xs text-textMuted">公网 ID（启动时自动生成 ULID，唯一性 ≈ 1/43亿）</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  value={instanceForm.public_id}
                  readOnly
                  className="flex-1 px-3 py-1.5 text-sm bg-canvas border border-border rounded-lg text-textPrimary font-mono cursor-default"
                />
                <button
                  onClick={handleRegenerateId}
                  className="shrink-0 px-2 py-1.5 text-[10px] text-textMuted hover:text-amber-400 border border-border rounded-lg hover:bg-amber-500/10 transition-colors"
                  title="重新生成公网 ID（用于冲突补救）"
                >
                  重新生成
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-textMuted">
                GitHub Token{' '}
                <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:text-primary-300">
                  获取 →
                </a>
              </label>
              <p className="text-[10px] text-textMuted mb-1">
                点击链接 → Generate new token (classic) → 勾选 <strong>repo</strong> → 复制粘贴到下方
              </p>
              <div className="flex gap-2 mt-1">
                <input
                  type="password"
                  value={githubToken}
                  onChange={e => setGithubToken(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-sm bg-canvas border border-border rounded-lg text-textPrimary font-mono"
                  placeholder={instance?.github_token_configured ? '已配置（重新输入会覆盖）' : 'ghp_xxxxxxxxxxxxxxxx'}
                />
                <button
                  onClick={handleSaveToken}
                  disabled={tokenSaving || !githubToken.trim()}
                  className={`shrink-0 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    tokenSaving || !githubToken.trim()
                      ? 'bg-canvas text-textMuted cursor-not-allowed'
                      : 'bg-amber-600 hover:bg-amber-500 text-white'
                  }`}
                >
                  {tokenSaving ? '保存中...' : '保存 Token'}
                </button>
              </div>
              {instance?.github_token_configured && !githubToken && (
                <p className="text-[10px] text-emerald-400 mt-1">🔑 已配置 Token（加密存储）</p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSaveInstance}
                className="px-4 py-1.5 text-xs bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors"
              >
                保存实例信息
              </button>
              <button
                onClick={handleRegister}
                disabled={registerState === 'loading'}
                className={`px-4 py-1.5 text-xs rounded-lg transition-colors ${
                  registerState === 'loading'
                    ? 'bg-canvas text-textMuted cursor-not-allowed'
                    : registerState === 'success'
                    ? 'bg-emerald-700 text-emerald-300'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {registerState === 'loading' ? '注册中...' : registerState === 'success' ? '✓ 已注册' : '注册到 GitHub'}
              </button>
            </div>
            {registerResult && (
              <p className={`text-xs whitespace-pre-line ${
                registerState === 'success' ? 'text-emerald-400' :
                registerState === 'loading' ? 'text-amber-400' :
                'text-rose-400'
              }`}>
                {registerErrorCode && (
                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-400 mr-1 font-mono">
                    {registerErrorCode}
                  </span>
                )}
                {registerResult}
              </p>
            )}
            {/* TOKEN_MISSING 时行内快速输入，无需跳转到编辑模式 */}
            {registerErrorCode === 'TOKEN_MISSING' && (
              <div className="flex gap-2 mt-2">
                <input
                  type="password"
                  value={quickToken}
                  onChange={e => setQuickToken(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-sm bg-canvas border border-border rounded-lg text-textPrimary font-mono"
                  placeholder="ghp_xxxxxxxxxxxxxxxx"
                />
                <button
                  onClick={handleQuickSaveToken}
                  disabled={registerState === 'loading' || !quickToken.trim()}
                  className="shrink-0 px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {registerState === 'loading' ? '保存中...' : '保存并重试'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-textMuted text-xs">子网 ID</span>
                <p className="text-textPrimary font-mono text-xs mt-0.5 truncate">{instance?.instance_id}</p>
              </div>
              <div>
                <span className="text-textMuted text-xs">公网 ID（ULID 自动生成）</span>
                <p className="text-textPrimary font-mono text-xs mt-0.5">
                  {instance?.public_id || <span className="text-textMuted italic">未生成</span>}
                </p>
              </div>
              <div>
                <span className="text-textMuted text-xs">显示名称</span>
                <p className="text-textPrimary text-xs mt-0.5">{instance?.display_name || '-'}</p>
              </div>
              <div>
                <span className="text-textMuted text-xs">公网 URL</span>
                <p className="text-textPrimary text-xs mt-0.5">{instance?.public_url || '-'}</p>
              </div>
              <div>
                <span className="text-textMuted text-xs">GitHub Token</span>
                <p className="text-xs mt-0.5">
                  {instance?.github_token_configured ? (
                    <span className="text-emerald-400">🔑 已配置（加密存储）</span>
                  ) : (
                    <span className="text-textMuted italic">未配置</span>
                  )}
                </p>
              </div>
            </div>
            {instance?.public_id && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleRegister}
                  disabled={isRegistering}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    isRegistering
                      ? 'bg-canvas text-textMuted cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  {isRegistering ? '注册中...' : registerState === 'success' ? '✓ 已注册' : '注册到 GitHub'}
                </button>
                {registerResult && (
                  <span className={`text-xs self-center ${
                    registerState === 'success' ? 'text-emerald-400' :
                    registerState === 'loading' ? 'text-amber-400' :
                    'text-rose-400'
                  }`}>
                    {registerErrorCode && <span className="font-mono mr-1">[{registerErrorCode}]</span>}
                    {registerResult}
                  </span>
                )}
                {/* TOKEN_MISSING 时行内快速输入 */}
                {registerErrorCode === 'TOKEN_MISSING' && (
                  <div className="flex gap-2 mt-2 w-full">
                    <input
                      type="password"
                      value={quickToken}
                      onChange={e => setQuickToken(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-sm bg-canvas border border-border rounded-lg text-textPrimary font-mono"
                      placeholder="ghp_xxxxxxxxxxxxxxxx"
                    />
                    <button
                      onClick={handleQuickSaveToken}
                      disabled={registerState === 'loading' || !quickToken.trim()}
                      className="shrink-0 px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {registerState === 'loading' ? '保存中...' : '保存并重试'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* 对等端列表 */}
      <section className="bg-surface border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-textPrimary flex items-center gap-2">
            <Link size={16} /> 对等端 ({peers.length})
          </h2>
          <button
            onClick={() => setShowAddPeer(!showAddPeer)}
            className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 transition-colors"
          >
            <Plus size={14} /> 添加
          </button>
        </div>

        {/* 添加对等端表单 */}
        {showAddPeer && (
          <div className="mb-4 p-4 bg-canvas rounded-lg border border-border space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-textMuted">公网 ID</label>
                <input
                  value={newPeer.peer_public_id}
                  onChange={e => setNewPeer({ ...newPeer, peer_public_id: e.target.value })}
                  className="w-full mt-1 px-3 py-1.5 text-sm bg-surface border border-border rounded-lg text-textPrimary font-mono"
                  placeholder="AIsChat-xxxxxxxx"
                />
              </div>
              <div>
                <label className="text-xs text-textMuted">显示名称</label>
                <input
                  value={newPeer.display_name}
                  onChange={e => setNewPeer({ ...newPeer, display_name: e.target.value })}
                  className="w-full mt-1 px-3 py-1.5 text-sm bg-surface border border-border rounded-lg text-textPrimary"
                  placeholder="花花的实例"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-textMuted">
                  WebSocket 地址（输入域名或 IP，自动拼接 <code className="text-[10px] bg-canvas px-1 rounded">/federation/ws</code>）
                </label>
                <div className="flex items-stretch mt-1">
                  <select
                    value={(newPeer.remote_url.match(/^(wss?):\/\//)?.[1]) || 'wss'}
                    onChange={e => {
                      const host = newPeer.remote_url.replace(/^wss?:\/\//, '').replace(/\/federation\/ws$/, '')
                      setNewPeer({ ...newPeer, remote_url: `${e.target.value}://${host}/federation/ws` })
                    }}
                    className="w-20 px-2 text-sm bg-surface border border-border rounded-l-lg text-textPrimary shrink-0"
                  >
                    <option value="wss">wss://</option>
                    <option value="ws">ws://</option>
                  </select>
                  <input
                    value={(() => {
                      const m = newPeer.remote_url.match(/^(wss?):\/\/(.+?)\/federation\/ws$/)
                      return m ? m[2] : newPeer.remote_url.replace(/^wss?:\/\//, '')
                    })()}
                    onChange={e => {
                      const proto = (newPeer.remote_url.match(/^(wss?):\/\//)?.[1]) || 'wss'
                      const host = e.target.value.replace(/\/$/, '')
                      setNewPeer({ ...newPeer, remote_url: `${proto}://${host}/federation/ws` })
                    }}
                    className="flex-1 px-3 py-1.5 text-sm bg-surface border border-border border-x-0 text-textPrimary font-mono"
                    placeholder="other-aichat.example.com"
                  />
                  <span className="inline-flex items-center px-2 text-xs text-textMuted bg-surface border border-border rounded-r-lg shrink-0 font-mono">
                    /federation/ws
                  </span>
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-textMuted">共享密钥</label>
                <input
                  type="password"
                  value={newPeer.shared_secret}
                  onChange={e => setNewPeer({ ...newPeer, shared_secret: e.target.value })}
                  className="w-full mt-1 px-3 py-1.5 text-sm bg-surface border border-border rounded-lg text-textPrimary"
                  placeholder="至少 8 位字符"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddPeer}
                className="px-4 py-1.5 text-xs bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors"
              >
                添加并连接
              </button>
              <button
                onClick={() => setShowAddPeer(false)}
                className="px-4 py-1.5 text-xs bg-canvas border border-border text-textSecondary rounded-lg hover:bg-border/20 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 对等端表格 */}
        {peers.length === 0 ? (
          <p className="text-sm text-textMuted py-4 text-center">暂无对等端，点击"添加"连接其他 AIsChat 实例</p>
        ) : (
          <div className="space-y-2">
            {peers.map(peer => (
              <div
                key={peer.id}
                className="flex items-center justify-between p-3 bg-canvas rounded-lg border border-border hover:border-primary-500/20 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    peer.connection_state === 'connected' ? 'bg-emerald-400' :
                    peer.connection_state === 'connecting' ? 'bg-amber-400 animate-pulse' :
                    'bg-slate-500'
                  }`} />
                  <div className="min-w-0">
                    <p className="text-sm text-textPrimary font-medium truncate">
                      {peer.display_name || peer.peer_public_id}
                    </p>
                    <p className="text-xs text-textMuted font-mono truncate">{peer.peer_public_id}</p>
                    <p className="text-[10px] text-textMuted truncate">{peer.remote_url}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {stateBadge(peer.connection_state)}
                  {peer.connection_state === 'connected' ? (
                    <button
                      onClick={() => handleDisconnect(peer.id)}
                      className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors"
                      title="断开"
                    >
                      <Power size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(peer.id)}
                      className="p-1.5 text-primary-400 hover:text-primary-300 hover:bg-primary-500/10 rounded-lg transition-colors"
                      title="连接"
                    >
                      <RefreshCw size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDeletePeer(peer.id)}
                    className="p-1.5 text-textMuted hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 联邦群聊 */}
      <section className="bg-surface border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-textPrimary flex items-center gap-2 mb-4">
          <Globe size={16} /> 联邦群聊
        </h2>
        <p className="text-sm text-textMuted">
          在群聊设置面板中，为每个群聊单独设置联邦共享。已启用联邦的群聊中的消息将自动转发到所选的对等端。
        </p>
        <p className="text-xs text-textMuted mt-2">
          💡 提示：请先在"对等端"中添加并连接其他实例，然后在群聊设置中开启联邦共享。
        </p>
      </section>
    </div>
  )
}
