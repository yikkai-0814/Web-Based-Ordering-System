/**
 * Which language the interface speaks.
 *
 * Pure by design, like theme.ts and staff-session.ts: what a stored value means, and what an
 * unrecognised one falls back to, is decided here and tested without a browser. The provider
 * does nothing but wire this to `localStorage` and `document`.
 *
 * **The dictionaries hold no vendor text.** Modifier group names, staff names and every other
 * thing a vendor typed are stored and shown exactly as entered — see the note on
 * `TranslationKey` in messages.ts for how that is enforced rather than merely intended. A menu
 * item's name and a modifier option's name are the exception, and not really one: the vendor
 * supplies those translations themselves and they live in the item's and the option's own
 * data, never here. See src/features/menu/localized-names.ts.
 */

/** Per-device, because a language is about the screen in front of somebody, not their account. */
export const LANGUAGE_STORAGE_KEY = 'ordering-system.language'

export const LANGUAGES = ['en', 'ms', 'zh'] as const

export type Language = (typeof LANGUAGES)[number]

/**
 * Each language named in itself, never translated.
 *
 * Somebody looking for Chinese is looking for 中文, not for the English word "Chinese" — a
 * menu of endonyms is readable to the person who needs it whatever the interface is currently
 * set to. This is the one label in the system that is deliberately outside the dictionaries.
 */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ms: 'Bahasa Melayu',
  zh: '中文',
}

/** What goes in `<html lang>`, so a screen reader and the browser agree with the interface. */
export const LANGUAGE_TAGS: Record<Language, string> = {
  en: 'en',
  ms: 'ms',
  zh: 'zh-Hans',
}

export const DEFAULT_LANGUAGE: Language = 'en'

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/**
 * Reads a stored preference back.
 *
 * Anything unrecognised — a value from an older build, a half-written string, a key set by
 * hand — falls back to English rather than guessing. English is the language every string in
 * this system is authored in, so it is the one answer that is never missing.
 */
export function parseLanguage(raw: string | null | undefined): Language {
  return isLanguage(raw) ? raw : DEFAULT_LANGUAGE
}
