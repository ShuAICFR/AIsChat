import { useState, useEffect } from 'react'
import { api } from '../api/client'
import { Key, Plus, Trash2, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react'

interface PoolKey {
  id: number
  name: string
  api_base_url: string
  api_key_preview: string
  is_active: boolean
  priority: number
  created_at: string | null
  updated_at: string | null
}

export default function ApiKeyPoolTab() {
  const [keys, setKeys] = useState<PoolKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  const loadKeys = async () => {
    try {
      const data = await api.get('/admin/api-key-pool')
      setKeys(data)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadKeys() }, [])

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定删除池 Key「${name}」？绑定此 Key 的用户将被自动解绑。`)) return
    try {
      await api.del(`/admin/api-key-pool/${id}`)
      loadKeys()
    } catch (err: any) {
      alert(err?.message || '删除失败')
    }
  }

  const handleToggle = async (id: number, currentActive: boolean) => {
    try {
      await api.put(`/admin/api-key-pool/${id}`, { is_active: !currentActive })
      loadKeys()
    } catch (err: any) {
      alert(err?.message || '操作失败')
    }
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <Loader2 className="animate-spin text-textSecondary" size={28} />
    </div>
  )

  return (
    <div className="space-y-5 pb-8">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-textPrimary flex items-center gap-2">
            <Key size={16} className="text-amber-400" /> API Key 池
          </h3>
          <p className="text-xs text-textMuted mt-0.5">
            管理系统级共享 API Key，用户兑换额度后自动从池中分配
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-xl hover:bg-primary-400 text-xs font-medium transition-colors"
        >
          <Plus size={14} /> 添加 Key
        </button>
      </div>

      {/* Key 列表 */}
      {keys.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-10 text-center">
          <Key size={32} className="mx-auto mb-3 text-textMuted" />
          <p className="text-sm text-textSecondary">暂无 API Key</p>
          <p className="text-xs text-textMuted mt-1">添加系统级共享 API Key，用户兑换额度后可自动使用</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-4 px-4 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-400 text-sm font-medium transition-colors"
          >
            添加第一个 Key
          </button>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm text-textPrimary">
            <thead>
              <tr className="border-b border-border bg-canvas">
                <th className="text-left py-2.5 px-3 text-xs font-medium text-textSecondary">名称</th>
                <th className="text-left py-2.5 px-3 text-xs font-medium text-textSecondary">API 地址</th>
                <th className="text-left py-2.5 px-3 text-xs font-medium text-textSecondary">Key</th>
                <th className="text-center py-2.5 px-3 text-xs font-medium text-textSecondary">优先级</th>
                <th className="text-center py-2.5 px-3 text-xs font-medium text-textSecondary">状态</th>
                <th className="text-right py-2.5 px-3 text-xs font-medium text-textSecondary">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {keys.map(k => (
                <tr key={k.id} className={`hover:bg-elevated/50 transition-colors ${!k.is_active ? 'opacity-50' : ''}`}>
                  <td className="py-2.5 px-3 font-medium">{k.name}</td>
                  <td className="py-2.5 px-3 text-xs text-textMuted font-mono">{k.api_base_url}</td>
                  <td className="py-2.5 px-3 text-xs text-textMuted font-mono">
                    <span title="Key 已加密存储，仅显示密文后四位">{k.api_key_preview || '—'}</span>
                  </td>
                  <td className="py-2.5 px-3 text-center">{k.priority}</td>
                  <td className="py-2.5 px-3 text-center">
                    <button
                      onClick={() => handleToggle(k.id, k.is_active)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${
                        k.is_active
                          ? 'bg-mint-400/10 text-mint-400'
                          : 'bg-rose-400/10 text-rose-400'
                      }`}
                      title={k.is_active ? '点击禁用' : '点击启用'}
                    >
                      {k.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      {k.is_active ? '启用' : '禁用'}
                    </button>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => handleDelete(k.id, k.name)}
                      className="p-1.5 rounded-lg hover:bg-rose-400/10 text-textMuted hover:text-rose-400 transition-colors"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 添加弹窗 */}
      {showAdd && <AddPoolKeyModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); loadKeys() }} />}
    </div>
  )
}

function AddPoolKeyModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [priority, setPriority] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!name.trim() || !apiKey.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post('/admin/api-key-pool', {
        name: name.trim(),
        api_base_url: apiBaseUrl.trim() || null,
        api_key: apiKey.trim(),
        priority,
      })
      onSaved()
    } catch (err: any) {
      setError(err?.message || err?.detail || '添加失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-elevated border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl shadow-black/30"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-1 text-textPrimary flex items-center gap-2">
          <Key size={18} className="text-amber-400" /> 添加 API Key
        </h3>
        <p className="text-xs text-textMuted mb-4">
          Key 将使用 Fernet 加密存储，添加后无法查看明文。
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1 text-textSecondary">名称 *</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="例：DeepSeek 主账号"
              className="w-full px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-textSecondary">API Base URL</label>
            <input
              type="text" value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder="留空继承全局设置"
              className="w-full px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-textSecondary">API Key *</label>
            <input
              type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-textSecondary">优先级（越高越优先分配）</label>
            <input
              type="number" value={priority} onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
              min={0} max={100}
              className="w-24 px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            />
          </div>
        </div>

        {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose}
            className="flex-1 py-2.5 text-sm border border-border rounded-xl hover:bg-elevated text-textSecondary transition-colors font-medium">
            取消
          </button>
          <button onClick={handleSave} disabled={!name.trim() || !apiKey.trim() || loading}
            className="flex-1 py-2.5 text-sm bg-primary-500 text-white rounded-xl hover:bg-primary-400 disabled:opacity-30 font-medium transition-all shadow-lg shadow-primary-500/20">
            {loading ? '添加中...' : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}
