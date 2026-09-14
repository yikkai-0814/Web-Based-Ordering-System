import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { I18nContext, type I18nContextValue, type Translate } from '@/features/i18n/i18n-context'
import {
  LANGUAGE_STORAGE_KEY,
  LANGUAGE_TAGS,
  parseLanguage,
  type Language,
} from '@/features/i18n/languages'
import { interpolate, type Message, type MessageParams } from '@/features/i18n/messages'
import { en, type Dictionary, type TranslationKey } from '@/features/i18n/translations/en'
import { ms } from '@/features/i18n/translations/ms'
import { zh } from '@/features/i18n/translations/zh'

/**
 * The language the interface is drawn in, and the one function that draws it.
 *
 * The same shape as ThemeProvider, deliberately: the rules live in the pure module beside it,
 * and this does nothing but hold the choice, persist it, and hand down `t`.
 *
 * Adding a fourth language is one entry here and one file beside `en.ts`. Because every
 * dictionary is typed as `Dictionary`, the compiler lists exactly which strings the new one
 * is missing.
 */
const DICTIONARIES: Record<Language, Dictionary> = { en, ms, zh }

/**
 * localStorage access, wrapped because it throws outright in some contexts (a browser set to
 * block site data, or a private window), and a till that cannot remember a preference should
 * still open.
 */
function readStoredLanguage(): Language {
  try {
    return parseLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY))
  } catch {
    return parseLanguage(null)
  }
}

function writeStoredLanguage(language: Language) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Preference lost at the end of the session. Not worth interrupting anybody over.
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => readStoredLanguage())

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next)
    writeStoredLanguage(next)
  }, [])

  // Kept in step with the document so assistive technology, the browser's own translation
  // offer, and CSS `:lang()` all agree with what is on screen.
  useEffect(() => {
    document.documentElement.lang = LANGUAGE_TAGS[language]
  }, [language])

  const value = useMemo<I18nContextValue>(() => {
    const dictionary = DICTIONARIES[language]

    /**
     * Falls back to English for a string the chosen dictionary somehow lacks.
     *
     * The types make that impossible at build time, so this only catches a dictionary
     * loaded from a stale bundle — in which case English is a worse answer than the right
     * language and a much better one than a blank.
     */
    const translate = ((first: TranslationKey | Message, params?: MessageParams) => {
      const key = typeof first === 'string' ? first : first.key
      const values = typeof first === 'string' ? params : first.params
      return interpolate(dictionary[key] ?? en[key], values)
    }) as Translate

    return { language, setLanguage, t: translate }
  }, [language, setLanguage])

  return <I18nContext value={value}>{children}</I18nContext>
}
