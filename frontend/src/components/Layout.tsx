import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import { useDesktopNotification } from '../hooks/useDesktopNotification'
import { I18nProvider } from '../i18n/I18nContext'

export default function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()

  // 桌面通知：标签页标题未读计数 + 任务栏闪烁（所有页面生效）
  useDesktopNotification()

  // 聊天详情页（群聊/私信）隐藏底部导航栏，给输入框更多空间
  const hideNav = /^\/chat\/(dm\/[^/]+|\d+)/.test(location.pathname)
                   || /^\/dm\/[^/]+/.test(location.pathname)

  return (
    <I18nProvider>
    <div className="flex h-dvh overflow-hidden bg-canvas">
      {/* ── 桌面端侧栏（始终可见） ── */}
      <div className="hidden md:block shrink-0">
        <Sidebar />
      </div>

      {/* ── 移动端抽屉遮罩 ── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60 transition-opacity"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── 移动端抽屉 ── */}
      <div
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-250 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar mobile onClose={() => setDrawerOpen(false)} />
      </div>

      {/* ── 主内容区 ── */}
      <main className={`flex-1 min-w-0 overflow-y-auto bg-canvas ${hideNav ? 'pb-0' : 'pb-14 md:pb-0'}`}>
        <Outlet context={{ openDrawer: () => setDrawerOpen(true), closeDrawer: () => setDrawerOpen(false) }} />
      </main>

      {/* ── 移动端底部导航（聊天详情页隐藏） ── */}
      {!hideNav && <MobileNav closeDrawer={() => setDrawerOpen(false)} />}
    </div>
    </I18nProvider>
  )
}
