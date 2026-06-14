import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'

export default function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      {/* ── 桌面端侧栏（始终可见） ── */}
      <div className="hidden md:block shrink-0">
        <Sidebar />
      </div>

      {/* ── 移动端抽屉遮罩 ── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity"
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
      <main className="flex-1 min-w-0 overflow-hidden bg-canvas pb-14 md:pb-0">
        <Outlet context={{ openDrawer: () => setDrawerOpen(true) }} />
      </main>

      {/* ── 移动端底部导航 ── */}
      <MobileNav />
    </div>
  )
}
