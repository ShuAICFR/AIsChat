import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { getStateDotColor } from '../constants'
import { X, Bell, BellOff, LogOut, UserX, Shield, ShieldOff, UserPlus, Volume2, VolumeX, Download, Clock, Globe, Check, Loader2, ArrowLeft } from 'lucide-react'

// ── 联邦共享子组件 ──

interface ConnectedPeer {
  id: number
  peer_public_id: string
  display_name: string
  connection_state: string
}

interface GroupShare {
  id: number
  peer_id: number
  peer_public_id: string
  peer_display_name: string
  share_direction: string
}

function FederationShareSection({ groupId }: { groupId: number }) {
  const [enabled, setEnabled] = useState(false)
  const [peers, setPeers] = useState<ConnectedPeer[]>([])
  const [shares, setShares] = useState<GroupShare[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // 加载已连接的 peer 和当前群聊的共享状态
  const loadData = async () => {
    setLoading(true)
    try {
      const [allPeers, groupShares] = await Promise.all([
        api.get<ConnectedPeer[]>('/admin/federation/peers'),
        api.get<GroupShare[]>(`/admin/federation/groups/${groupId}/shares`),
      ])
      // 仅显示已连接的对等端
      setPeers(allPeers.filter(p => p.connection_state === 'connected'))
      setShares(groupShares)
      setEnabled(groupShares.length > 0)
    } catch {
      // 静默失败
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  // 切换某个 peer 的共享状态
  const togglePeer = async (peerId: number, currentlyShared: boolean) => {
    try {
      if (currentlyShared) {
        await api.delete(`/admin/federation/groups/${groupId}/shares/${peerId}`)
      } else {
        await api.post(`/admin/federation/groups/${groupId}/shares`, {
          peer_id: peerId,
          share_direction: 'bidirectional',
        })
      }
      // 重新加载
      const groupShares = await api.get<GroupShare[]>(`/admin/federation/groups/${groupId}/shares`)
      setShares(groupShares)
      setEnabled(groupShares.length > 0)
    } catch {
      // 静默失败
    }
  }

  // 展开/收起
  if (!loaded) {
    return (
      <button
        onClick={loadData}
        disabled={loading}
        className="w-full flex items-center justify-between py-0.5"
      >
        <div className="text-left">
          <div className="text-sm text-textPrimary font-medium">🌐 联邦共享</div>
          <div className="text-xs text-textMuted">点击加载已连接的对等端</div>
        </div>
        {loading ? <Loader2 size={16} className="animate-spin text-textMuted" /> : <span className="text-xs text-primary-400">加载</span>}
      </button>
    )
  }

  if (peers.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-textPrimary font-medium">🌐 联邦共享</div>
            <div className="text-xs text-textMuted">暂无可用的已连接对等端</div>
          </div>
        </div>
        <p className="text-xs text-textMuted">
          请先在<strong>管理员面板 → 联邦</strong>中添加并连接对等端，然后回到此处共享。
        </p>
      </div>
    )
  }

  const sharedPeerIds = new Set(shares.map(s => s.peer_id))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-textPrimary font-medium">🌐 联邦共享</div>
          <div className="text-xs text-textMuted">
            已共享给 {shares.length} 个对等端，消息将自动转发
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="text-xs text-textMuted hover:text-textSecondary transition-colors"
          title="刷新"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : '刷新'}
        </button>
      </div>

      <div className="space-y-1.5">
        {peers.map(peer => {
          const isShared = sharedPeerIds.has(peer.id)
          return (
            <label
              key={peer.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                isShared
                  ? 'border-primary-500/30 bg-primary-500/5'
                  : 'border-border bg-canvas hover:border-primary-500/20'
              }`}
            >
              <input
                type="checkbox"
                checked={isShared}
                onChange={() => togglePeer(peer.id, isShared)}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                isShared
                  ? 'bg-primary-500 border-primary-500'
                  : 'border-textMuted'
              }`}>
                {isShared && <Check size={12} className="text-white" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-textPrimary font-medium truncate">
                  {peer.display_name || peer.peer_public_id}
                </p>
                <p className="text-[10px] text-textMuted font-mono truncate">
                  {peer.peer_public_id}
                </p>
              </div>
              <span className="flex items-center gap-1 text-[10px] text-emerald-400 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                已连接
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

interface GroupMember {
  type: string
  id: number
  name: string
  state?: string
  role: string
  dnd_until?: string | null
}

interface GroupSettings {
  id: number
  name: string
  owner_type: string
  owner_id: number
  is_vector_accelerated: boolean
  announcement: string | null
  speak_limit_per_minute: number
  speak_limit_window_seconds: number
  is_federated: boolean
  my_role: string
}

interface Props {
  group: GroupSettings | null
  onClose: () => void
  onUpdate: (updated: Partial<GroupSettings>) => void
  onLeave: () => void
}

type Tab = 'general' | 'members' | 'speak' | 'export'

export default function GroupSettingsPanel({ group, onClose, onUpdate, onLeave }: Props) {
  const [tab, setTab] = useState<Tab>('general')
  const [members, setMembers] = useState<GroupMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 表单状态
  const [name, setName] = useState(group?.name || '')
  const [announcement, setAnnouncement] = useState(group?.announcement || '')
  const [speakLimit, setSpeakLimit] = useState(group?.speak_limit_per_minute || 0)
  const [speakWindow, setSpeakWindow] = useState(group?.speak_limit_window_seconds || 120)
  const [vectorAccel, setVectorAccel] = useState(group?.is_vector_accelerated || false)
  const [dndUntil, setDndUntil] = useState<string | null>(null)
  const [customDndMinutes, setCustomDndMinutes] = useState('')
  const [saving, setSaving] = useState(false)

  // 导出状态
  const [exportFormat, setExportFormat] = useState('json')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const isOwner = group?.my_role === 'owner'
  const isAdmin = group?.my_role === 'admin' || isOwner
  const isAiOwned = group?.owner_type === 'ai'

  useEffect(() => {
    if (!group) return
    setName(group.name)
    setAnnouncement(group.announcement || '')
    setSpeakLimit(group.speak_limit_per_minute || 0)
    setSpeakWindow(group.speak_limit_window_seconds || 120)
    setVectorAccel(group.is_vector_accelerated || false)
    loadMembers()
    loadDndStatus()
  }, [group?.id])

  const loadMembers = async () => {
    if (!group) return
    try {
      const data = await api.get(`/groups/${group.id}/members`)
      setMembers(data)
    } catch { /* ignore */ }
  }

  const loadDndStatus = async () => {
    if (!group) return
    try {
      // DND 状态从群列表中的 dnd_until 获取
      // 这里通过重新获取群列表来刷新
      const groups = await api.get('/groups')
      const g = groups.find((g: any) => g.id === group.id)
      if (g) setDndUntil(g.dnd_until || null)
    } catch { /* ignore */ }
  }

  const saveSettings = async (updates: Record<string, any>) => {
    if (!group) return
    setSaving(true)
    setError('')
    try {
      await api.patch(`/groups/${group.id}`, updates)
      onUpdate(updates)
    } catch (e: any) {
      setError(e?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSetDnd = async (minutes: number | null) => {
    if (!group) return
    try {
      await api.post(`/groups/${group.id}/dnd`, { group_id: group.id, duration_minutes: minutes })
      const until = minutes === null ? 'permanent' : new Date(Date.now() + minutes * 60_000).toISOString()
      setDndUntil(until)
    } catch (e: any) {
      setError(e?.detail || '操作失败')
    }
  }

  const handleCustomDnd = async () => {
    if (!group) return
    const mins = parseInt(customDndMinutes, 10)
    if (isNaN(mins) || mins <= 0) {
      setError('请输入有效的分钟数')
      return
    }
    if (mins > 10080) {
      setError('单次免打扰最长 7 天（10080 分钟）')
      return
    }
    await handleSetDnd(mins)
    setCustomDndMinutes('')
  }

  const handleCancelDnd = async () => {
    if (!group) return
    try {
      await api.post(`/groups/${group.id}/dnd/cancel`)
      setDndUntil(null)
    } catch (e: any) {
      setError(e?.detail || '操作失败')
    }
  }

  const handleRoleChange = async (m: GroupMember, newRole: string) => {
    if (!group) return
    try {
      await api.patch(`/groups/${group.id}/members/${m.type}/${m.id}/role`, { role: newRole })
      setMembers(prev => prev.map(x => x.id === m.id && x.type === m.type ? { ...x, role: newRole } : x))
    } catch (e: any) {
      setError(e?.detail || '操作失败')
    }
  }

  const handleKick = async (m: GroupMember) => {
    if (!group) return
    if (!confirm(`确定要将 ${m.name} 移出群聊？`)) return
    try {
      await api.delete(`/groups/${group.id}/members/${m.type}/${m.id}`)
      setMembers(prev => prev.filter(x => !(x.id === m.id && x.type === m.type)))
    } catch (e: any) {
      setError(e?.detail || '操作失败')
    }
  }

  const handleLeave = async () => {
    if (!group) return
    if (!confirm('确定要退出此群聊？')) return
    try {
      await api.post(`/groups/${group.id}/leave`)
      onLeave()
    } catch (e: any) {
      setError(e?.detail || '退出失败')
    }
  }

  const handleExportChat = async () => {
    if (!group) return
    setExporting(true)
    setExportError('')
    try {
      const token = localStorage.getItem('access_token')
      const params = new URLSearchParams({ fmt: exportFormat })
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await fetch(`/api/groups/${group.id}/export?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '导出失败')
      }
      const blob = await res.blob()
      const ext = exportFormat === 'txt' ? 'txt' : exportFormat === 'html' ? 'html' : 'json'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `chat_${group.name}_${new Date().toISOString().slice(0, 10)}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setExportError(e.message)
    } finally {
      setExporting(false)
    }
  }

  if (!group) return null

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'general', label: '基本设置', show: true },
    { key: 'members', label: '成员管理', show: true },
    { key: 'speak', label: 'AI 发言限制', show: isAdmin },
    { key: 'export', label: '导出记录', show: true },
  ]

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 点击外部关闭（桌面端） */}
      <div className="absolute inset-0 bg-black/30 hidden md:block" onClick={onClose} />

      <div className="relative w-full md:w-96 max-w-full h-full bg-surface md:border-l border-border shadow-2xl flex flex-col animate-slide-in">
        {/* 头部 */}
        <div className="h-14 px-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-elevated text-textSecondary transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <h2 className="font-semibold text-sm text-textPrimary">群聊设置</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-elevated text-textMuted hidden md:block">
            <X size={16} />
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-border shrink-0">
          {tabs.filter(t => t.show).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? 'text-primary-400 border-b-2 border-primary-400'
                  : 'text-textMuted hover:text-textSecondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-[var(--safe-bottom)] md:pb-4">
          {error && (
            <div className="text-xs text-rose-400 bg-rose-400/10 rounded-lg px-3 py-2">{error}</div>
          )}

          {/* === Tab: 基本设置 === */}
          {tab === 'general' && (
            <>
              {/* 群名称 */}
              <div>
                <label className="text-xs font-medium text-textSecondary">群聊名称</label>
                <div className="flex gap-2 mt-1">
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    disabled={!isAdmin}
                    className="flex-1 bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-textPrimary disabled:opacity-50 outline-none focus:border-primary-400"
                  />
                  {isAdmin && (
                    <button
                      onClick={() => saveSettings({ name })}
                      disabled={saving || name === group.name}
                      className="px-3 py-2 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-400 disabled:opacity-50 transition-colors"
                    >
                      保存
                    </button>
                  )}
                </div>
              </div>

              {/* 群公告 */}
              <div>
                <label className="text-xs font-medium text-textSecondary">群公告</label>
                {isAdmin ? (
                  <div className="mt-1 space-y-2">
                    <textarea
                      value={announcement}
                      onChange={e => setAnnouncement(e.target.value)}
                      placeholder="输入群公告..."
                      rows={3}
                      className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-textPrimary outline-none focus:border-primary-400 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveSettings({ announcement })}
                        disabled={saving}
                        className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-400 disabled:opacity-50 transition-colors"
                      >
                        更新公告
                      </button>
                      {group.announcement && (
                        <button
                          onClick={async () => {
                            try {
                              await api.delete(`/groups/${group.id}/announcement`)
                              setAnnouncement('')
                              onUpdate({ announcement: null })
                            } catch (e: any) { setError(e?.detail || '操作失败') }
                          }}
                          className="px-3 py-1.5 bg-rose-400/10 text-rose-400 rounded-lg text-xs font-medium hover:bg-rose-400/20 transition-colors"
                        >
                          删除公告
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-textSecondary bg-elevated rounded-lg px-3 py-2">
                    {group.announcement || '暂无公告'}
                  </p>
                )}
              </div>

              <hr className="border-border" />

              {/* 免打扰 */}
              <div>
                <h3 className="text-sm font-medium text-textPrimary flex items-center gap-2 mb-3">
                  <Bell size={14} className="text-textMuted" />
                  消息免打扰
                </h3>
                {dndUntil ? (
                  <div className="space-y-3">
                    <div className="bg-mint-400/10 text-mint-400 rounded-lg px-3 py-2 text-xs flex items-center gap-2">
                      <BellOff size={14} />
                      免打扰已开启
                    </div>
                    <button
                      onClick={handleCancelDnd}
                      className="w-full px-4 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-400 transition-colors"
                    >
                      取消免打扰
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-textMuted">选择免打扰时长，期间不会收到该群消息通知</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: '15 分钟', minutes: 15 },
                        { label: '30 分钟', minutes: 30 },
                        { label: '1 小时', minutes: 60 },
                        { label: '4 小时', minutes: 240 },
                        { label: '8 小时', minutes: 480 },
                        { label: '永久', minutes: null as unknown as number },
                      ].map((d) => (
                        <button
                          key={d.label}
                          onClick={() => handleSetDnd(d.minutes)}
                          className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-elevated hover:bg-primary-500/10 hover:text-primary-400 text-textSecondary border border-border rounded-lg text-xs font-medium transition-colors"
                        >
                          <Clock size={12} />
                          {d.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="number"
                        value={customDndMinutes}
                        onChange={(e) => setCustomDndMinutes(e.target.value)}
                        placeholder="自定义分钟数..."
                        min={1}
                        max={10080}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCustomDnd() }}
                        className="flex-1 bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-textPrimary outline-none focus:border-primary-400 placeholder:text-textMuted"
                      />
                      <button
                        onClick={handleCustomDnd}
                        disabled={!customDndMinutes.trim()}
                        className="px-3 py-2 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-400 disabled:opacity-50 transition-colors shrink-0"
                      >
                        设置
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 向量加速（仅管理员可见） */}
              {isAdmin && (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-textPrimary font-medium">向量加速</div>
                    <div className="text-xs text-textMuted">
                      {isAiOwned ? 'AI 群自动启用' : '混合检索历史消息'}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const next = !vectorAccel
                      setVectorAccel(next)
                      saveSettings({ is_vector_accelerated: next })
                    }}
                    className={`w-11 h-6 rounded-full transition-colors relative ${
                      vectorAccel ? 'bg-primary-500' : 'bg-border'
                    }`}
                  >
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      vectorAccel ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              )}

              {/* 联邦共享（仅管理员可见） */}
              {isAdmin && <FederationShareSection groupId={group!.id} />}

              <hr className="border-border" />

              {/* 退群 */}
              <button
                onClick={handleLeave}
                disabled={isOwner && !group.name.startsWith('DM:')}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-400/10 text-rose-400 rounded-lg text-sm font-medium hover:bg-rose-400/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title={isOwner && !group.name.startsWith('DM:') ? '群主需先转让群主身份' : '退出群聊'}
              >
                <LogOut size={16} />
                {isOwner && !group.name.startsWith('DM:') ? '群主无法退群（需先转让）' : '退出群聊'}
              </button>
            </>
          )}

          {/* === Tab: 成员管理 === */}
          {tab === 'members' && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-textPrimary font-medium">
                  成员 ({members.length})
                </span>
                <button
                  onClick={() => {
                    // 触发父组件的邀请弹窗
                    const event = new CustomEvent('open-invite-modal')
                    window.dispatchEvent(event)
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-primary-400 hover:bg-primary-400/10 rounded-lg transition-colors"
                >
                  <UserPlus size={14} />
                  邀请
                </button>
              </div>

              <div className="space-y-1">
                {members.map(m => (
                  <div
                    key={`${m.type}:${m.id}`}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-elevated transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* 状态圆点 */}
                      <span className={`w-2 h-2 rounded-full shrink-0 ${getStateDotColor(m.state)}`} />
                      <div className="min-w-0">
                        <div className="text-sm text-textPrimary truncate flex items-center gap-1.5">
                          {m.name}
                          {m.type === 'ai' && (
                            <span className="text-[10px] text-primary-400 font-medium">AI</span>
                          )}
                        </div>
                        <div className="text-[10px] text-textMuted">
                          {m.role === 'owner' ? '群主' : m.role === 'admin' ? '管理员' : '成员'}
                          {m.dnd_until && ' · 免打扰'}
                        </div>
                      </div>
                    </div>

                    {/* 操作按钮（群主/管理员可见，不可操作自己） */}
                    {isAdmin && m.role !== 'owner' && (
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        {isOwner && (
                          <button
                            onClick={() => handleRoleChange(m, m.role === 'admin' ? 'member' : 'admin')}
                            className="p-1 rounded hover:bg-elevated text-textMuted hover:text-primary-400 transition-colors"
                            title={m.role === 'admin' ? '降级为成员' : '提拔为管理员'}
                          >
                            {m.role === 'admin' ? <ShieldOff size={14} /> : <Shield size={14} />}
                          </button>
                        )}
                        <button
                          onClick={() => handleKick(m)}
                          className="p-1 rounded hover:bg-rose-400/10 text-textMuted hover:text-rose-400 transition-colors"
                          title="移出群聊"
                        >
                          <UserX size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* === Tab: AI 发言限制（仅管理员） === */}
          {tab === 'speak' && isAdmin && (
            <>
              {isAiOwned ? (
                <div className="text-center py-8">
                  <Volume2 size={32} className="mx-auto text-mint-400 mb-3" />
                  <p className="text-sm text-textPrimary font-medium">AI 自建群聊</p>
                  <p className="text-xs text-textMuted mt-1">
                    此群由 AI 管理，不设发言限制。<br />
                    AI 之间可自由交流协作。
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-textSecondary">
                        每分钟最多发言次数
                      </label>
                      <span className="text-xs text-primary-400 font-medium">
                        {speakLimit === 0 ? '不限制' : `${speakLimit} 条/分钟`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={30}
                      value={speakLimit}
                      onChange={e => setSpeakLimit(Number(e.target.value))}
                      className="w-full accent-primary-500"
                    />
                    <div className="flex justify-between text-[10px] text-textMuted">
                      <span>0（不限）</span>
                      <span>30</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-textSecondary">
                        统计时间窗口（秒）
                      </label>
                      <span className="text-xs text-primary-400 font-medium">{speakWindow}s</span>
                    </div>
                    <input
                      type="range"
                      min={30}
                      max={600}
                      step={30}
                      value={speakWindow}
                      onChange={e => setSpeakWindow(Number(e.target.value))}
                      className="w-full accent-primary-500"
                    />
                    <div className="flex justify-between text-[10px] text-textMuted">
                      <span>30s</span>
                      <span>600s</span>
                    </div>
                  </div>

                  {/* 预览 */}
                  <div className="bg-elevated rounded-lg px-3 py-2.5 text-xs text-textSecondary space-y-1">
                    <div className="font-medium text-textPrimary">效果预览</div>
                    {speakLimit > 0 ? (
                      <div>
                        每 {speakWindow} 秒内最多允许 <span className="text-primary-400 font-medium">{speakLimit * 2}</span> 轮 AI 对话
                        <br />
                        <span className="text-textMuted">
                          （每轮包含一次 AI 发言，预留 2x 余量保证对话完整）
                        </span>
                      </div>
                    ) : (
                      <div>不限制 AI 发言频率，对话链仅靠意愿分自然终结</div>
                    )}
                  </div>

                  <button
                    onClick={() => saveSettings({
                      speak_limit_per_minute: speakLimit,
                      speak_limit_window_seconds: speakWindow,
                    })}
                    disabled={saving}
                    className="w-full px-4 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-400 disabled:opacity-50 transition-colors"
                  >
                    {saving ? '保存中...' : '保存发言限制'}
                  </button>
                </>
              )}
            </>
          )}

          {/* === Tab: 导出记录 === */}
          {tab === 'export' && (
            <>
              <div>
                <label className="text-xs font-medium text-textSecondary">导出格式</label>
                <div className="flex gap-2 mt-1">
                  {[
                    { key: 'json', label: 'JSON', desc: '结构化数据' },
                    { key: 'txt', label: '文本', desc: '易读文本' },
                    { key: 'html', label: 'HTML', desc: '精美网页' },
                  ].map(f => (
                    <button
                      key={f.key}
                      onClick={() => setExportFormat(f.key)}
                      className={`flex-1 py-3 px-2 rounded-xl border text-center transition-colors ${
                        exportFormat === f.key
                          ? 'border-primary-400 bg-primary-500/10 text-primary-600 dark:text-primary-300'
                          : 'border-border bg-canvas text-textSecondary hover:bg-elevated'
                      }`}
                    >
                      <div className="text-sm font-medium">{f.label}</div>
                      <div className="text-[10px] text-textMuted">{f.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-textSecondary">日期范围（可选）</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="flex-1 bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-textPrimary"
                  />
                  <span className="text-textMuted text-xs">至</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="flex-1 bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-textPrimary"
                  />
                </div>
              </div>

              <button
                onClick={handleExportChat}
                disabled={exporting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-40 text-sm font-medium transition-all"
              >
                <Download size={16} />
                {exporting ? '导出中...' : '下载导出文件'}
              </button>

              {exportError && <div className="text-xs text-rose-400">{exportError}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
