import { useNavigate, useLocation } from 'react-router-dom'
import { MessageCircle, Bot, User, Users } from 'lucide-react'
import { useT } from '../i18n/I18nContext'

const tabs = [
  { path: '/chat', i18nKey: 'nav.chat', icon: MessageCircle },
  { path: '/friends', i18nKey: 'nav.friends', icon: Users },
  { path: '/agents', i18nKey: 'nav.ai', icon: Bot },
  { path: '/me', i18nKey: 'nav.me', icon: User },
]

interface MobileNavProps {
  closeDrawer?: () => void
}

export default function MobileNav({ closeDrawer }: MobileNavProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const t = useT()

  const isActive = (path: string) => {
    if (path === '/chat') return location.pathname.startsWith('/chat') || location.pathname === '/'
    if (path === '/friends') return location.pathname.startsWith('/friends')
    if (path === '/agents') return location.pathname.startsWith('/agents')
    if (path === '/me') return location.pathname.startsWith('/me')
    return false
  }

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-surface/95 backdrop-blur-lg border-t border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex h-14">
        {tabs.map((tab) => {
          const active = isActive(tab.path)
          return (
            <button
              key={tab.path}
              onClick={() => { closeDrawer?.(); navigate(tab.path) }}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-all duration-200 relative ${
                active ? 'text-primary-400' : 'text-textMuted'
              }`}
            >
              {/* Active top indicator */}
              {active && (
                <div className="absolute top-0 left-1/4 right-1/4 h-0.5 bg-primary-400 rounded-full" />
              )}
              {/* Icon with optional pulse ring */}
              <div className="relative">
                <tab.icon size={22} strokeWidth={active ? 2.5 : 2} />
                {active && (
                  <div className="absolute -inset-1.5 rounded-full ai-pulse-active opacity-50" />
                )}
              </div>
              <span className="text-[10px] font-medium">{t(tab.i18nKey)}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
