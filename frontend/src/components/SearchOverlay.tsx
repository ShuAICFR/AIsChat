import { useState, useEffect, useRef } from 'react'
import { Search, UserPlus, UserCheck, Clock, X, Send } from 'lucide-react'
import { api } from '../api/client'

interface SearchResult {
  id: number
  type: 'human' | 'ai'
  name: string
  owner_name: string | null
  is_friend: boolean
  state: string | null
}

export default function SearchOverlay() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pendingRequests, setPendingRequests] = useState<Set<string>>(new Set())
  // 加好友附言弹窗
  const [addFriendTarget, setAddFriendTarget] = useState<SearchResult | null>(null)
  const [addFriendMessage, setAddFriendMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 防抖搜索
  useEffect(() => {
    if (query.length < 1) {
      setResults([])
      setShowDropdown(false)
      return
    }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await api.get<{ results: SearchResult[] }>(
          `/search?q=${encodeURIComponent(query)}`
        )
        setResults(data.results)
        setShowDropdown(true)
      } catch (err) {
        console.error('搜索失败:', err)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  // 点击外部关闭
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleOpenAddFriend = (item: SearchResult) => {
    setAddFriendTarget(item)
    setAddFriendMessage('')
  }

  const handleSendFriendRequest = async () => {
    if (!addFriendTarget) return
    const { type, id } = addFriendTarget
    try {
      const result = await api.post<{ status: string }>('/friends/requests', {
        target_type: type,
        target_id: id,
        message: addFriendMessage.trim() || undefined,
      })
      if (result.status === 'accepted') {
        setResults(prev => prev.map(r =>
          r.type === type && r.id === id ? { ...r, is_friend: true } : r
        ))
      } else {
        setPendingRequests(prev => new Set(prev).add(`${type}:${id}`))
      }
      setAddFriendTarget(null)
    } catch (err: any) {
      alert(err.message || '发送失败')
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* 搜索框 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-canvas border border-border rounded-xl">
        <Search size={14} className="text-textMuted shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          placeholder="搜索用户或 AI..."
          className="flex-1 bg-transparent text-sm text-textPrimary placeholder:text-textMuted focus:outline-none"
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]) }} className="text-textMuted hover:text-textSecondary">
            <X size={14} />
          </button>
        )}
      </div>

      {/* 下拉结果 */}
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-elevated border border-border rounded-xl shadow-2xl shadow-black/30 z-50 max-h-80 overflow-y-auto">
          {loading ? (
            <div className="p-3 text-sm text-textMuted text-center">搜索中...</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-sm text-textMuted text-center">无结果</div>
          ) : (
            results.map((item) => (
              <div
                key={`${item.type}:${item.id}`}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-elevated"
              >
                {/* 头像 */}
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-bold shrink-0 ${
                  item.type === 'human'
                    ? 'from-primary-500 to-primary-700 text-white'
                    : 'from-mint-400 to-emerald-600 text-white'
                }`}>
                  {item.name.charAt(0).toUpperCase()}
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-textPrimary truncate">
                      {item.name}
                    </span>
                    <span className="text-xs text-textMuted shrink-0">
                      {item.type === 'ai' ? '🤖AI' : '👤'}
                    </span>
                    {item.state && (
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        item.state === 'active' ? 'bg-mint-400' :
                        item.state === 'dnd' ? 'bg-rose-400' : 'bg-[#6B7280]'
                      }`} />
                    )}
                  </div>
                  {item.owner_name && (
                    <div className="text-xs text-textMuted truncate">创建者: {item.owner_name}</div>
                  )}
                </div>

                {/* 操作按钮 */}
                {item.is_friend ? (
                  <span className="text-xs text-mint-400 flex items-center gap-1 shrink-0">
                    <UserCheck size={12} /> 好友
                  </span>
                ) : pendingRequests.has(`${item.type}:${item.id}`) ? (
                  <span className="text-xs text-accent-400 flex items-center gap-1 shrink-0">
                    <Clock size={12} /> 已申请
                  </span>
                ) : (
                  <button
                    onClick={() => handleOpenAddFriend(item)}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-primary-500/10 text-primary-400 hover:bg-primary-500/20 shrink-0 transition-colors"
                  >
                    <UserPlus size={12} /> 加好友
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* 加好友附言弹窗 */}
      {addFriendTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={() => setAddFriendTarget(null)}>
          <div
            className="bg-elevated border border-border rounded-2xl p-5 w-full max-w-sm mx-4 shadow-2xl shadow-black/30"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                addFriendTarget.type === 'human'
                  ? 'bg-gradient-to-br from-primary-500 to-primary-700 text-white'
                  : 'bg-gradient-to-br from-mint-400 to-emerald-600 text-white'
              }`}>
                {addFriendTarget.name.charAt(0)}
              </div>
              <div>
                <h3 className="font-semibold text-textPrimary text-sm">{addFriendTarget.name}</h3>
                <p className="text-xs text-textMuted">
                  {addFriendTarget.type === 'ai' ? 'AI 角色' : '人类用户'}
                </p>
              </div>
              <button onClick={() => setAddFriendTarget(null)} className="ml-auto text-textMuted hover:text-textSecondary">
                <X size={18} />
              </button>
            </div>

            <textarea
              value={addFriendMessage}
              onChange={(e) => setAddFriendMessage(e.target.value)}
              placeholder="附言（可选）—— 对方接受后会显示在对话开头"
              rows={3}
              maxLength={200}
              className="w-full px-3 py-2 rounded-xl border border-border bg-canvas text-sm text-textPrimary placeholder:text-textMuted focus:outline-none focus:ring-2 focus:ring-primary-500/50 resize-none mb-3"
              autoFocus
            />

            <div className="flex gap-2">
              <button
                onClick={() => setAddFriendTarget(null)}
                className="flex-1 py-2 rounded-xl border border-border text-textSecondary hover:text-textPrimary text-sm font-medium transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSendFriendRequest}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl bg-primary-500 text-white hover:bg-primary-400 transition-colors text-sm font-medium"
              >
                <Send size={14} />
                发送申请
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
