import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import ChatPage from './pages/ChatPage'
import DMPage from './pages/DMPage'
import AgentsPage from './pages/AgentsPage'
import AgentDetailPage from './pages/AgentDetailPage'
import SettingsPage from './pages/SettingsPage'
import MePage from './pages/MePage'
import UsagePage from './pages/UsagePage'
import AdminPage from './pages/AdminPage'
import FriendsPage from './pages/FriendsPage'
import SetupPage from './pages/SetupPage'
import ManualPage from './pages/ManualPage'
import InstanceSetupPage from './pages/InstanceSetupPage'
import LocalModelPage from './pages/LocalModelPage'

function ProtectedLayout() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />

  // 新用户需先完成初始化设置向导
  if (!user.setup_completed && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />
  }

  // 桌面端首次启动：未配置实例地址则跳转到配置页
  if (
    '__TAURI_INTERNALS__' in window &&
    !localStorage.getItem('instance_url') &&
    location.pathname !== '/instance-setup'
  ) {
    return <Navigate to="/instance-setup" replace />
  }

  return <Layout />
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user || user.role !== 'admin') return <Navigate to="/chat" replace />
  return <>{children}</>
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'chat/gm/:groupId', element: <ChatPage /> },
      { path: 'dm', element: <Navigate to="/chat" replace /> },
      { path: 'dm/:sessionId', element: <DMPage /> },
      { path: 'chat/dm/:sessionId', element: <ChatPage /> },
      { path: 'friends', element: <FriendsPage /> },
      { path: 'agents', element: <AgentsPage /> },
      { path: 'agents/:id', element: <AgentDetailPage /> },
      { path: 'me', element: <MePage /> },
      { path: 'me/usage', element: <UsagePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'setup', element: <SetupPage /> },
      { path: 'instance-setup', element: <InstanceSetupPage /> },
      { path: 'local-models', element: <LocalModelPage /> },
      { path: 'manual', element: <ManualPage /> },
      { path: 'manual/admin', element: <ManualPage /> },
      {
        path: 'admin',
        element: <AdminGuard><AdminPage /></AdminGuard>,
      },
    ],
  },
])
