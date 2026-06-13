import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { MessageCircle, Users, Bot, Settings, Shield, LogOut, Menu, X, ChevronLeft } from 'lucide-react'
import SearchOverlay from './SearchOverlay'
import FriendList from './FriendList'
import FriendRequestBadge from './FriendRequestBadge'

const mainNavItems = [
  { to: '/chat', label: '聊天', icon: MessageCircle },
  { to: '/agents', label: '我的 AI', icon: Bot },
  { to: '/settings', label: '设置', icon: Settings },
]

export default function Sidebar() {
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
        collapsed ? 'w-16' : 'w-60'
      } bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col transition-all duration-200 shrink-0`}
    >
      {/* 头部 */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        {!collapsed && (
          <h1 className="text-lg font-bold text-primary-600 dark:text-primary-400 truncate">
            AI 群聊
          </h1>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          title={collapsed ? '展开' : '折叠'}
        >
          {collapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* 搜索框 */}
      {!collapsed && (
        <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <SearchOverlay />
        </div>
      )}

      {/* 用户信息 */}
      {!collapsed && user && (
        <div className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium truncate">{user.username}</p>
            <p className="text-xs text-gray-500">
              ID: {user.id} · {user.role === 'admin' ? '管理员' : `额度: ${user.ai_quota}`}
            </p>
          </div>
          <FriendRequestBadge />
        </div>
      )}

      {/* 主导航 + 好友面板 */}
      {!collapsed && !showFriendList && (
        <nav className="flex-1 py-2">
          {/* 聊天 - 特殊处理：点击不跳转，仅切换到群聊视图 */}
          <NavLink
            to="/chat"
            onClick={() => setShowFriendList(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg transition-colors ${
                isActive
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`
            }
          >
            <MessageCircle size={20} />
            <span>聊天</span>
          </NavLink>

          {/* 好友 - 展开好友列表 */}
          <button
            onClick={() => {
              setShowFriendList(true)
              setFriendRefresh(Date.now())
            }}
            className="flex items-center gap-3 w-full px-4 py-2.5 mx-2 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <Users size={20} />
            <span>好友</span>
          </button>

          {mainNavItems.filter(i => i.to !== '/chat').map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setShowFriendList(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`
              }
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}

          {user?.role === 'admin' && (
            <NavLink
              to="/admin"
              onClick={() => setShowFriendList(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`
              }
            >
              <Shield size={20} />
              <span>管理</span>
            </NavLink>
          )}
        </nav>
      )}

      {/* 好友列表面板 */}
      {!collapsed && showFriendList && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">好友列表</span>
            <button
              onClick={() => setShowFriendList(false)}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
              title="返回导航"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-2 px-2">
            <FriendList refreshTrigger={friendRefresh} />
          </div>
        </div>
      )}

      {/* 折叠时的最小导航 */}
      {collapsed && (
        <nav className="flex-1 py-2">
          {[
            { to: '/chat', label: '聊天', icon: MessageCircle },
            { to: '/agents', label: '我的 AI', icon: Bot },
            { to: '/settings', label: '设置', icon: Settings },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center justify-center py-2.5 mx-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`
              }
              title={item.label}
            >
              <item.icon size={20} />
            </NavLink>
          ))}
          {/* 折叠时：好友按钮 */}
          <button
            onClick={() => {
              setCollapsed(false)
              setShowFriendList(true)
              setFriendRefresh(Date.now())
            }}
            className="flex items-center justify-center w-full py-2.5 mx-2 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            title="好友"
          >
            <Users size={20} />
          </button>
          {user?.role === 'admin' && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex items-center justify-center py-2.5 mx-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`
              }
              title="管理面板"
            >
              <Shield size={20} />
            </NavLink>
          )}
        </nav>
      )}

      {/* 退出 */}
      <div className="p-2 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-4 py-2.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          title={collapsed ? '退出登录' : undefined}
        >
          <LogOut size={20} />
          {!collapsed && <span>退出</span>}
        </button>
      </div>
    </aside>
  )
}
