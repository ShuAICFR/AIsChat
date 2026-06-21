import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useT } from '../i18n/I18nContext'
import { overrideLangForSetup } from '../i18n/I18nContext'
import { api } from '../api/client'
import { Globe, Check } from 'lucide-react'

type Lang = 'zh' | 'en'

export default function SetupPage() {
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedLang, setSelectedLang] = useState<Lang>('en')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { refreshUser } = useAuth()
  const navigate = useNavigate()
  const t = useT()

  const handleSelectLang = (lang: Lang) => {
    setSelectedLang(lang)
    overrideLangForSetup(lang)
  }

  const handleNext = () => {
    if (!selectedLang) return
    setStep(2)
  }

  const handleComplete = async () => {
    setSaving(true)
    setError('')
    try {
      await api.post('/auth/setup', { language: selectedLang })
      overrideLangForSetup(null) // 清除临时覆盖
      await refreshUser()
      navigate('/chat', { replace: true })
    } catch (err: any) {
      setError(err.message || t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const langOptions: { value: Lang; label: string; desc: string }[] = [
    { value: 'zh', label: '中文（简体）', desc: 'Chinese (Simplified)' },
    { value: 'en', label: 'English', desc: '英语 / English' },
  ]

  return (
    <div className="h-full flex items-center justify-center bg-canvas">
      <div className="max-w-md w-full px-4">
        {/* 进度指示器 */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
            step === 1 ? 'bg-primary-500 text-white' : 'bg-mint-400 text-white'
          }`}>
            {step === 1 ? '1' : <Check size={16} />}
          </div>
          <div className={`w-10 h-0.5 rounded transition-colors ${step === 2 ? 'bg-mint-400' : 'bg-border'}`} />
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
            step === 2 ? 'bg-primary-500 text-white' : 'bg-border text-textMuted'
          }`}>
            2
          </div>
        </div>

        {/* 内容卡片 */}
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-xl">
          {step === 1 ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Globe size={18} className="text-primary-400" />
                <h2 className="text-lg font-semibold text-textPrimary">{t('setup.step1Title')}</h2>
              </div>
              <p className="text-sm text-textMuted mb-6">{t('setup.step1Desc')}</p>

              <div className="space-y-3">
                {langOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleSelectLang(opt.value)}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all duration-200 ${
                      selectedLang === opt.value
                        ? 'border-primary-400 bg-primary-500/10 shadow-sm shadow-primary-500/10'
                        : 'border-border hover:border-borderHover bg-canvas'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      selectedLang === opt.value
                        ? 'border-primary-400 bg-primary-400'
                        : 'border-border'
                    }`}>
                      {selectedLang === opt.value && <Check size={12} className="text-white" />}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-textPrimary">{opt.label}</div>
                      <div className="text-xs text-textMuted">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>

              <button
                onClick={handleNext}
                className="w-full mt-6 py-2.5 bg-primary-500 hover:bg-primary-400 text-white rounded-xl font-semibold text-sm transition-all duration-200"
              >
                {t('setup.next')}
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Globe size={18} className="text-mint-400" />
                <h2 className="text-lg font-semibold text-textPrimary">{t('setup.step2Title')}</h2>
              </div>
              <p className="text-sm text-textMuted mb-6">{t('setup.step2Desc')}</p>

              <div className="bg-canvas rounded-xl p-4 border border-border mb-6">
                <div className="text-xs text-textMuted mb-1">{t('setup.selectedLang')}</div>
                <div className="text-sm font-medium text-textPrimary">
                  {selectedLang === 'zh' ? '中文（简体）' : 'English'}
                </div>
              </div>

              {error && (
                <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2.5 mb-4">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  disabled={saving}
                  className="flex-1 py-2.5 border border-border rounded-xl text-sm text-textSecondary hover:bg-canvas transition-colors disabled:opacity-30"
                >
                  {t('setup.back')}
                </button>
                <button
                  onClick={handleComplete}
                  disabled={saving}
                  className="flex-1 py-2.5 bg-mint-400 hover:bg-mint-500 disabled:opacity-30 text-white rounded-xl font-semibold text-sm transition-all duration-200"
                >
                  {saving ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    </span>
                  ) : (
                    t('setup.complete')
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
