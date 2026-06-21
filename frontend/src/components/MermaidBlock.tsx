import { useEffect, useRef, useState, useId } from 'react'
import { Loader2, AlertTriangle, Maximize2, Minimize2 } from 'lucide-react'

interface MermaidBlockProps {
  code: string
  /** 是否为聊天消息中的（限制最大宽高） */
  compact?: boolean
}

/**
 * Mermaid 图表渲染块。
 * - 使用 mermaid.run() 渲染 SVG
 * - 支持点击全屏查看（compact 模式）
 * - 渲染失败时显示源码
 */
export default function MermaidBlock({ code, compact = false }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const uniqueId = useId().replace(/:/g, '')

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const mermaid = (await import('mermaid')).default

        // 初始化（mermaid.initialize 幂等，每次调用不影响性能）
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'sandbox',
          fontFamily: 'inherit',
        })

        const { svg: rendered } = await mermaid.render(`mermaid-${uniqueId}`, code)
        if (!cancelled) {
          setSvg(rendered)
          setError(null)
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Mermaid 渲染失败')
          setSvg(null)
        }
      }
    }

    render()
    return () => { cancelled = true }
  }, [code, uniqueId])

  // 错误态
  if (error) {
    return (
      <div className="my-3 rounded-xl border border-rose-400/20 bg-rose-400/5 overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-400/10 border-b border-rose-400/10 text-[10px] text-rose-400 font-medium">
          <AlertTriangle size={12} /> Mermaid 图表渲染失败
        </div>
        <pre className="p-3 text-xs text-textSecondary overflow-x-auto whitespace-pre-wrap break-all">
          {code}
        </pre>
      </div>
    )
  }

  // 加载态
  if (!svg) {
    return (
      <div className="my-3 rounded-xl border border-border bg-elevated p-4 flex items-center gap-2 text-textMuted text-sm">
        <Loader2 size={14} className="animate-spin" />
        图表加载中...
      </div>
    )
  }

  // 成功
  const containerClass = compact
    ? 'my-2 rounded-xl border border-border bg-white dark:bg-[#1e1e2e] overflow-hidden max-w-full'
    : 'my-4 rounded-xl border border-border bg-white dark:bg-[#1e1e2e] overflow-hidden'

  const wrapperClass = expanded
    ? 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm'
    : ''

  const svgContainerClass = expanded
    ? 'bg-white dark:bg-[#1e1e2e] rounded-2xl p-6 max-w-[90vw] max-h-[90vh] overflow-auto shadow-2xl'
    : 'overflow-x-auto p-4'
    + (compact ? ' max-h-[420px] overflow-y-auto' : '')

  return (
    <>
      <div className={containerClass}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-elevated/50 border-b border-border">
          <span className="text-[10px] text-textMuted font-medium tracking-wide uppercase">
            Mermaid
          </span>
          {compact && (
            <button
              onClick={() => setExpanded(true)}
              className="p-0.5 rounded hover:bg-surface text-textMuted hover:text-textPrimary transition-colors"
              title="全屏查看"
            >
              <Maximize2 size={13} />
            </button>
          )}
        </div>

        {/* SVG 内容 */}
        <div
          ref={containerRef}
          className={svgContainerClass}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      {/* 全屏浮层 */}
      {expanded && (
        <div
          className={wrapperClass}
          onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false) }}
        >
          <div className={svgContainerClass + ' relative'}>
            <button
              onClick={() => setExpanded(false)}
              className="absolute top-3 right-3 p-1.5 rounded-lg bg-surface hover:bg-elevated text-textSecondary hover:text-textPrimary transition-colors z-10"
              title="关闭"
            >
              <Minimize2 size={16} />
            </button>
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        </div>
      )}
    </>
  )
}
