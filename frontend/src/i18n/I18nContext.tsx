import { createContext, useContext, useCallback, type ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { getTranslation } from './translations'

type Lang = 'zh' | 'en'

interface I18nContextType {
  lang: Lang
  t: (path: string) => string
}

const I18nContext = createContext<I18nContextType>({
  lang: 'zh',
  t: (path: string) => path,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const lang: Lang = (user?.language === 'en' ? 'en' : 'zh')

  const t = useCallback(
    (path: string) => getTranslation(lang, path),
    [lang]
  )

  return (
    <I18nContext.Provider value={{ lang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useT() {
  const ctx = useContext(I18nContext)
  return ctx.t
}

export function useLang() {
  const ctx = useContext(I18nContext)
  return ctx.lang
}
