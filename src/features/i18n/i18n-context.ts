import { createContext } from 'react'

import type { Language } from '@/features/i18n/languages'
import type { Message, MessageParams } from '@/features/i18n/messages'
import type { TranslationKey } from '@/features/i18n/translations/en'

/**
 * Translates a predefined string.
 *
 * Takes either a key with its parameters, or a `Message` a pure module produced. It does NOT
 * take an arbitrary string, and that is the point — vendor-entered text cannot be passed
 * through it even by accident, because it will not typecheck.
 */
export interface Translate {
  (key: TranslationKey, params?: MessageParams): string
  (message: Message): string
}

export interface I18nContextValue {
  language: Language
  setLanguage: (next: Language) => void
  t: Translate
}

export const I18nContext = createContext<I18nContextValue | null>(null)
