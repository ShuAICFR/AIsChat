import React from 'react'

interface ToggleProps {
  /** 当前是否开启 */
  checked: boolean
  /** 切换回调 */
  onChange: (checked: boolean) => void
  /** 禁用状态 */
  disabled?: boolean
  /** 标签文本（可选，显示在开关左侧） */
  label?: string
}

/**
 * 统一开关/Toggle 组件
 *
 * 统一规格（与 OpenCLI 开关一致）：
 * - 轨道 48×24px（w-12 h-6）
 * - 滑块 20×20px（w-5 h-5）
 * - 开启 bg-mint-400，关闭 bg-border
 * - 白色滑块 + shadow
 */
const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled = false, label }) => {
  const track = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`w-12 h-6 rounded-full transition-colors shrink-0 border-2 border-border ${
        disabled ? 'opacity-40 cursor-not-allowed' : ''
      } ${checked ? 'bg-mint-400 border-mint-400' : 'bg-canvas'}`}
    >
      <div
        className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-0.5'
        }`}
      />
    </button>
  )

  if (label) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-textPrimary">{label}</span>
        {track}
      </div>
    )
  }

  return track
}

export default Toggle
