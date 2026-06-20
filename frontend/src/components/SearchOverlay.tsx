import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, MessageSquare } from 'lucide-react'
import { api } from '../api/client'
import { getStateDotColor } from '../constants'

interface SearchResult {
  id: number
  type: 'human' | 'ai'
  name: string
  owner_name: string | null
  state: string | null
}

export default function SearchOverlay() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sendingDM, setSendingDM] = useState<string | null>(null) // `${type}:${id}`
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

  const handleSendDM = async (item: SearchResult) => {
    const targetId = item.type === 'human' ? item.id : item.id
    const key = `${item.type}:${item.id}`
    setSendingDM(key)
    try {
      // 直接调用 DM API 获取或创建 DM 会话
      const dm = await api.post<{ session_id: string }>(`/dm/${targetId}`)
      if (dm.session_id) {
        navigate(`/chat/dm/${dm.session_id}`)
        setShowDropdown(false)
        setQuery('')
      }
    } catch (err: any) {
      alert(err.message || '发起私信失败')
    } finally {
      setSendingDM(null)
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
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getStateDotColor(item.state)}`} />
                    )}
                  </div>
                  {item.owner_name && (
                    <div className="text-xs text-textMuted truncate">创建者: {item.owner_name}</div>
                  )}
                </div>

                {/* 操作按钮 — 直接发私信 */}
                <button
                  onClick={() => handleSendDM(item)}
                  disabled={sendingDM === `${item.type}:${item.id}`}
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-primary-500/10 text-primary-400 hover:bg-primary-500/20 shrink-0 transition-colors disabled:opacity-50"
                >
                  <MessageSquare size={12} />
                  {sendingDM === `${item.type}:${item.id}` ? '...' : '发私信'}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
