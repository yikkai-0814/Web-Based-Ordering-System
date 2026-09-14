import { useContext } from 'react'

import { I18nContext, type I18nContextValue } from '@/features/i18n/i18n-context'

export function useTranslation(): I18nContextValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useTranslation must be used inside <LanguageProvider>')
  return value
}
