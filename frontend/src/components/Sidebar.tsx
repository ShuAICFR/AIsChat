import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { MessageCircle, Bot, Settings, Shield, LogOut, Menu, X, ChevronLeft, BookOpen, ExternalLink, Users } from 'lucide-react'
import { MANUAL_URL } from '../constants'
import SearchOverlay from './SearchOverlay'

const mainNavItems = [
  { to: '/chat', label: '聊天', icon: MessageCircle },
  { to: '/friends', label: '好友', icon: Users },
  { to: '/agents', label: '我的 AI', icon: Bot },
  { to: '/settings', label: '设置', icon: Settings },
]

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2.5 mx-2 rounded-xl text-sm font-medium transition-all duration-200 ${
    isActive
      ? 'bg-primary-500/15 text-primary-300'
      : 'text-textSecondary hover:text-textPrimary hover:bg-elevated'
  }`

export default function Sidebar({ mobile, onClose }: { mobile?: boolean; onClose?: () => void }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside
      className={`${
        collapsed ? 'w-16 h-full' : mobile ? 'w-full h-full' : 'w-60 h-full'
      } bg-surface border-r border-border flex flex-col transition-all duration-200 shrink-0`}
    >
      {/* 头部 */}
      <div className="h-14 px-4 border-b border-border flex items-center justify-between shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow shadow-primary-500/30">
              <MessageCircle size={12} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="text-base font-bold text-textPrimary tracking-tight">AIsChat</span>
          </div>
        )}
        {mobile ? (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-elevated text-textMuted hover:text-textSecondary transition-colors ml-auto"
          >
            <X size={20} />
          </button>
        ) : (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-lg hover:bg-elevated text-textMuted hover:text-textSecondary transition-colors"
            title={collapsed ? '展开' : '折叠'}
          >
            {collapsed ? <Menu size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}
      </div>

      {/* 搜索框 */}
      {!collapsed && (
        <div className="px-3 py-2 border-b border-border">
          <SearchOverlay />
        </div>
      )}

      {/* 用户信息 */}
      {!collapsed && user && (
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-textPrimary truncate">{user.username}</p>
            <p className="text-xs text-textMuted">
              {user.role === 'admin' ? (
                <span className="text-accent-400">管理员</span>
              ) : (
                `额度 ${user.ai_quota}`
              )}
            </p>
          </div>
        </div>
      )}

      {/* 主导航 */}
      {!collapsed && (
        <nav className="flex-1 py-3 space-y-0.5">
          {mainNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => { if (mobile) onClose?.() }}
              className={navLinkClass}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}

          {user?.role === 'admin' && (
            <NavLink to="/admin" onClick={() => { if (mobile) onClose?.() }} className={navLinkClass}>
              <Shield size={18} />
              <span>管理</span>
            </NavLink>
          )}

          <a
            href={MANUAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={navLinkClass({ isActive: false })}
            title={collapsed ? '使用手册（外部链接）' : undefined}
          >
            <BookOpen size={18} />
            <span className="flex items-center gap-1">
              手册
              <ExternalLink size={10} className="text-textMuted" />
            </span>
          </a>
        </nav>
      )}

      {/* 折叠时的最小导航 */}
      {collapsed && (
        <nav className="flex-1 py-3 space-y-0.5 flex flex-col items-center">
          {[
            { to: '/chat', label: '聊天', icon: MessageCircle },
            { to: '/friends', label: '好友', icon: Users },
            { to: '/agents', label: 'AI', icon: Bot },
            { to: '/settings', label: '设置', icon: Settings },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => { if (mobile) onClose?.() }}
              className={({ isActive }) =>
                `flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-500/15 text-primary-300'
                    : 'text-textSecondary hover:text-textPrimary hover:bg-elevated'
                }`
              }
              title={item.label}
            >
              <item.icon size={18} />
            </NavLink>
          ))}
          {user?.role === 'admin' && (
            <NavLink
              to="/admin"
              onClick={() => { if (mobile) onClose?.() }}
              className={({ isActive }) =>
                `flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-500/15 text-primary-300'
                    : 'text-textSecondary hover:text-textPrimary hover:bg-elevated'
                }`
              }
              title="管理面板"
            >
              <Shield size={18} />
            </NavLink>
          )}
          <a
            href={MANUAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200 text-textSecondary hover:text-textPrimary hover:bg-elevated"
            title="使用手册（外部链接）"
          >
            <BookOpen size={18} />
          </a>
        </nav>
      )}

      {/* 退出 */}
      <div className="p-2 border-t border-border shrink-0">
        <button
          onClick={handleLogout}
          className={`flex items-center rounded-xl text-textSecondary hover:text-rose-400 hover:bg-rose-500/10 transition-all duration-200 text-sm ${
            collapsed ? 'justify-center w-10 h-10' : 'gap-3 w-full px-3 py-2.5'
          }`}
          title={collapsed ? '退出登录' : undefined}
        >
          <LogOut size={18} />
          {!collapsed && <span>退出</span>}
        </button>
      </div>
    </aside>
  )
}
