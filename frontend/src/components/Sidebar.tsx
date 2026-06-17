import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { MessageCircle, Users, Bot, Settings, Shield, LogOut, Menu, X, ChevronLeft } from 'lucide-react'
import SearchOverlay from './SearchOverlay'
import FriendList from './FriendList'
import FriendRequestBadge from './FriendRequestBadge'

const mainNavItems = [
  { to: '/chat', label: '聊天', icon: MessageCircle },
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
  const [showFriendList, setShowFriendList] = useState(false)
  const [friendRefresh, setFriendRefresh] = useState(0)

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
          <FriendRequestBadge />
        </div>
      )}

      {/* 主导航 */}
      {!collapsed && !showFriendList && (
        <nav className="flex-1 py-3 space-y-0.5">
          <NavLink to="/chat" onClick={() => setShowFriendList(false)} className={navLinkClass}>
            <MessageCircle size={18} />
            <span>聊天</span>
          </NavLink>

          <button
            onClick={() => { setShowFriendList(true); setFriendRefresh(Date.now()) }}
            className="flex items-center gap-3 w-full px-3 py-2.5 mx-2 rounded-xl text-sm font-medium transition-all duration-200 text-textSecondary hover:text-textPrimary hover:bg-elevated text-left"
          >
            <Users size={18} />
            <span>好友</span>
          </button>

          {mainNavItems.filter(i => i.to !== '/chat').map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setShowFriendList(false)}
              className={navLinkClass}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}

          {user?.role === 'admin' && (
            <NavLink to="/admin" onClick={() => setShowFriendList(false)} className={navLinkClass}>
              <Shield size={18} />
              <span>管理</span>
            </NavLink>
          )}
        </nav>
      )}

      {/* 好友列表面板 */}
      {!collapsed && showFriendList && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-sm font-medium text-textPrimary">好友列表</span>
            <button
              onClick={() => setShowFriendList(false)}
              className="p-1 rounded hover:bg-elevated text-textMuted hover:text-textSecondary"
              title="返回导航"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2 px-2">
            <FriendList
              refreshTrigger={friendRefresh}
              onSelectFriend={async (friend) => {
                const targetUserId = (friend as any).friend_user_id || friend.friend_id
                try {
                  const dm = await api.post(`/dm/${targetUserId}`)
                  if (dm.session_id) navigate(`/chat/dm/${dm.session_id}`)
                } catch { /* ignore */ }
              }}
            />
          </div>
        </div>
      )}

      {/* 折叠时的最小导航 */}
      {collapsed && (
        <nav className="flex-1 py-3 space-y-0.5 flex flex-col items-center">
          {[
            { to: '/chat', label: '聊天', icon: MessageCircle },
            { to: '/agents', label: 'AI', icon: Bot },
            { to: '/settings', label: '设置', icon: Settings },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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
          <button
            onClick={() => { setCollapsed(false); setShowFriendList(true); setFriendRefresh(Date.now()) }}
            className="flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200 text-textSecondary hover:text-textPrimary hover:bg-elevated"
            title="好友"
          >
            <Users size={18} />
          </button>
          {user?.role === 'admin' && (
            <NavLink
              to="/admin"
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
