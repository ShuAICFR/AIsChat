import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-hidden bg-canvas">
        <Outlet />
      </main>
    </div>
  )
}
