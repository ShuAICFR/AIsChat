import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { Globe, Link, Plus, Trash2, RefreshCw, Power, Shield } from 'lucide-react'

interface InstanceInfo {
  instance_id: string
  public_id: string | null
  display_name: string
  public_url: string
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
  const [registerResult, setRegisterResult] = useState('')
  const [registering, setRegistering] = useState(false)

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
    setRegistering(true)
    setRegisterResult('')
    try {
      const result = await api.post<{ success: boolean; message: string; conflict?: boolean }>('/admin/federation/instance/register')
      setRegisterResult(result.message || (result.success ? '注册成功' : '注册失败'))
    } catch (e: any) {
      setRegisterResult(e?.response?.data?.detail || e?.message || '注册失败，请确认已配置 GITHUB_TOKEN')
    } finally {
      setRegistering(false)
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

  return (
    <div className="space-y-6">
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
              <label className="text-xs text-textMuted">公网 URL</label>
              <input
                value={instanceForm.public_url}
                onChange={e => setInstanceForm({ ...instanceForm, public_url: e.target.value })}
                className="w-full mt-1 px-3 py-1.5 text-sm bg-canvas border border-border rounded-lg text-textPrimary"
                placeholder="wss://my-aichat.example.com/federation/ws"
              />
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
            <div className="flex gap-2">
              <button
                onClick={handleSaveInstance}
                className="px-4 py-1.5 text-xs bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors"
              >
                保存
              </button>
              <button
                onClick={handleRegister}
                disabled={registering}
                className={`px-4 py-1.5 text-xs rounded-lg transition-colors ${
                  registering
                    ? 'bg-canvas text-textMuted cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {registering ? '注册中...' : '注册到 GitHub'}
              </button>
            </div>
            {registerResult && (
              <p className={`text-xs ${registerResult.includes('成功') ? 'text-emerald-400' : 'text-rose-400'}`}>
                {registerResult}
              </p>
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
            </div>
            {instance?.public_id && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleRegister}
                  disabled={registering}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    registering
                      ? 'bg-canvas text-textMuted cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  {registering ? '注册中...' : '注册到 GitHub'}
                </button>
                {registerResult && (
                  <span className={`text-xs self-center ${registerResult.includes('成功') ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {registerResult}
                  </span>
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
                <label className="text-xs text-textMuted">WebSocket URL</label>
                <input
                  value={newPeer.remote_url}
                  onChange={e => setNewPeer({ ...newPeer, remote_url: e.target.value })}
                  className="w-full mt-1 px-3 py-1.5 text-sm bg-surface border border-border rounded-lg text-textPrimary font-mono"
                  placeholder="wss://other-aichat.example.com/federation/ws"
                />
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
