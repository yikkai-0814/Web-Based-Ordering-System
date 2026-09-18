/**
 * How anything a vendor named is named in more than one language.
 *
 * Extracted from item-names.ts when modifier options gained translations, because there must
 * be exactly ONE answer in this system to "what is this called on a screen set to Malay, and
 * what happens when nobody has said?" — a second copy of that rule is a second chance for the
 * two to disagree, and the one that had drifted would be invisible.
 *
 * Nothing here knows what it is naming. `item-names.ts` and `option-names.ts` are the two
 * subjects; each adds only its own length limit and its own error messages, and both read
 * through the same parse, the same fallback and the same "what is worth storing" rule.
 *
 * **This is not a translation dictionary.** `en.ts`, `ms.ts` and `zh.ts` hold interface text
 * and nothing a vendor typed; these are the vendor's own words and belong to the vendor's
 * own data, which is what this module reads and writes.
 *
 * ## What is stored, and why it is not what is read
 *
 * A document keeps its English name where it has always kept it, in `name`, and carries
 * translations — and only translations — in an optional `names` map:
 *
 * ```
 * { name: 'Fried Egg', names: { ms: 'Telur Goreng', zh: '煎蛋' } }
 * ```
 *
 * The obvious alternative, `names: { en, ms, zh }`, would store English twice: once in the
 * field every existing document, every security rule and every sort already uses, and again
 * inside the map. Two copies of one fact can disagree. So English stays in `name` and the map
 * holds what `name` cannot say.
 *
 * The app, meanwhile, reads a complete `LocalizedName` with every language answered —
 * `parseNames` fills English in from `name` — so looking one up is a lookup and a fallback
 * rather than a special case for one language.
 */

import { LANGUAGES, type Language } from '@/features/i18n/languages'
import { message, type Message } from '@/features/i18n/messages'
import type { TranslationKey } from '@/features/i18n/translations/en'

/** Every language a translation may be given for — that is, all of them except English. */
export type TranslatableLanguage = Exclude<Language, 'en'>

export const TRANSLATABLE_LANGUAGES: readonly TranslatableLanguage[] = LANGUAGES.filter(
  (language): language is TranslatableLanguage => language !== 'en',
)

/**
 * What is written to Firestore: the translations that have words in them.
 *
 * A language the admin left blank is absent rather than stored as an empty string — a subject
 * with no translations at all writes `{}` and looks exactly like every document written
 * before this feature existed.
 */
export type NameTranslations = Partial<Record<TranslatableLanguage, string>>

/** What the app reads: every language answered, English never empty. */
export type LocalizedName = Record<Language, string>

/**
 * The shape a localized lookup needs.
 *
 * Structural, so a test can pass a literal, and `names` is optional even though anything that
 * went through `parseNames` always has one: the promise is that the subject is nameable, and
 * one that somehow reached a screen without the map — raw data that skipped the parse, a
 * fixture written before this feature — must still show its English name rather than crash a
 * till.
 */
export interface NamedSubject {
  name: string
  names?: LocalizedName
}

/**
 * Builds the complete set of names from a document's `name` and its optional `names` map.
 *
 * Everything is tolerated and nothing is trusted: a missing map, a map holding a number, a
 * key for a language this build does not have. Each resolves to "no translation", which the
 * fallback below already handles — the same posture as every other parser here, which refuses
 * a malformed document rather than rendering it as `undefined`.
 */
export function parseNames(name: string, raw: unknown): LocalizedName {
  const translations: Record<string, unknown> =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}

  return Object.fromEntries(
    LANGUAGES.map((language) => {
      if (language === 'en') return [language, name.trim()]
      const value = translations[language]
      return [language, typeof value === 'string' ? value.trim() : '']
    }),
  ) as LocalizedName
}

/**
 * What this subject is called on a screen set to this language.
 *
 * 1. The translation for that language, when it has one.
 * 2. Otherwise English, which a valid document always has.
 *
 * Use it for the subject as it stands **today**. Never for an order that has already been
 * placed: a line's name, and every chosen option's name, were snapshotted when they were rung
 * up and are the record of what the customer was told they were buying.
 */
export function localizedNameOf(subject: NamedSubject, language: Language): string {
  const translated = subject.names?.[language]?.trim()
  if (translated) return translated
  return subject.names?.en.trim() || subject.name.trim()
}

/**
 * The translations worth storing: trimmed, and only the ones that say something.
 *
 * Whitespace is not a translation. A name of spaces would pass a naive emptiness check and
 * then render as a blank gap on a till, so it is dropped here and the subject falls back to
 * English exactly as if nothing had been typed.
 *
 * Takes a partial record rather than a full `LocalizedName` so both callers can pass what they
 * actually hold: the item form edits all three fields together, while the modifier option
 * editor keeps English in its own input and hands over the translations alone.
 */
export function storedTranslations(names: Partial<Record<Language, string>>): NameTranslations {
  const stored: NameTranslations = {}
  for (const language of TRANSLATABLE_LANGUAGES) {
    const value = names[language]?.trim()
    if (value) stored[language] = value
  }
  return stored
}

/**
 * How many languages this subject has actually been translated into.
 *
 * Whitespace does not count, for the same reason it is not stored: it would light up the
 * editor's badge for a translation that falls back to English anyway.
 */
export function translationCount(names: Partial<Record<Language, string>>): number {
  return Object.keys(storedTranslations(names)).length
}

/**
 * Folds what a dialog handed back into a full set of names, clearing what it left out.
 *
 * The caller holds every language together — that is what stops an admin editing Malay from
 * wiping Chinese — so a language the dialog returned nothing for has to be emptied rather
 * than left at its old value, or clearing a translation would silently fail.
 */
export function withTranslations(current: LocalizedName, next: NameTranslations): LocalizedName {
  const updated = { ...current }
  for (const language of TRANSLATABLE_LANGUAGES) {
    updated[language] = next[language] ?? ''
  }
  return updated
}

/** An untouched set of fields, for a create form. */
export function emptyNames(): LocalizedName {
  return Object.fromEntries(LANGUAGES.map((language) => [language, ''])) as LocalizedName
}

export type NamesResult = { ok: true; names: LocalizedName } | { ok: false; error: Message }

/**
 * Validates what the admin typed into the name fields.
 *
 * English is required, because it is what every other language falls back to — a subject
 * without it could not be named at all on a till set to Malay. The translations are optional
 * and held to the same maximum length as English, since they end up in the same places.
 *
 * Pure, and the same shape as `validateStaffName` and `validateVoidReason`, for the same
 * reason: it is not the control — firestore.rules is, wherever rules can reach — it is what
 * stops the form sending a write the server would refuse.
 *
 * The limit and both messages are the caller's, because they are the only part of naming that
 * differs between a menu item and a modifier option.
 */
export function validateNames(
  draft: LocalizedName,
  limits: { max: number; required: TranslationKey; tooLong: TranslationKey },
): NamesResult {
  const names = Object.fromEntries(
    LANGUAGES.map((language) => [language, draft[language].trim()]),
  ) as LocalizedName

  if (names.en === '') return { ok: false, error: message(limits.required) }

  for (const language of LANGUAGES) {
    if (names[language].length > limits.max) {
      return { ok: false, error: message(limits.tooLong, { max: limits.max }) }
    }
  }

  return { ok: true, names }
}
