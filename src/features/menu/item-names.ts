/**
 * What a menu item is called, in each language the interface speaks.
 *
 * Pure, like cart.ts and voids.ts, so the fallback rule can be tested exhaustively without a
 * browser or an emulator. It is also the ONE place that rule lives: no component decides for
 * itself what to show when a translation is missing.
 *
 * **This is not a translation dictionary.** `en.ts`, `ms.ts` and `zh.ts` hold interface text
 * and nothing a vendor typed; an item's names are the vendor's own words and belong to the
 * item's data, which is what this module reads and writes.
 *
 * ## What is stored, and why it is not what is read
 *
 * A menu item document keeps its English name where it has always kept it, in `name`, and
 * carries translations — and only translations — in an optional `names` map:
 *
 * ```
 * { name: 'Fried Rice', names: { ms: 'Nasi Goreng', zh: '炒饭' } }
 * ```
 *
 * The obvious alternative, `names: { en, ms, zh }`, would store English twice: once in the
 * field every existing document, every security rule and every sort already uses, and again
 * inside the map. Two copies of one fact can disagree, and the one that had drifted would be
 * invisible. So English stays in `name` and the map holds what `name` cannot say.
 *
 * The app, meanwhile, reads a complete `LocalizedName` with every language answered —
 * `parseItemNames` fills English in from `name` — so `getLocalizedMenuItemName` is a lookup
 * and a fallback rather than a special case for one language.
 */

import { LANGUAGES, type Language } from '@/features/i18n/languages'
import { message, type Message } from '@/features/i18n/messages'

/**
 * The longest a menu item's name may be, in any language.
 *
 * Mirrored in firestore.rules; keep the two in step. It lives here rather than in types.ts
 * because this is the module that owns what a name is; types.ts re-exports it, so every
 * existing import still reads the same constant.
 */
export const ITEM_NAME_MAX = 80

/** Every language a translation may be given for — that is, all of them except English. */
export type TranslatableLanguage = Exclude<Language, 'en'>

export const TRANSLATABLE_LANGUAGES: readonly TranslatableLanguage[] = LANGUAGES.filter(
  (language): language is TranslatableLanguage => language !== 'en',
)

/**
 * What is written to Firestore: the translations that have words in them.
 *
 * A language the admin left blank is absent rather than stored as an empty string — an item
 * with no translations at all writes `{}` and looks exactly like every item written before
 * this feature existed.
 */
export type ItemNameTranslations = Partial<Record<TranslatableLanguage, string>>

/** What the app reads: every language answered, English never empty. */
export type LocalizedName = Record<Language, string>

/**
 * The shape `getLocalizedMenuItemName` needs.
 *
 * Structural, so a test can pass a literal, and `names` is optional here even though a
 * parsed `MenuItem` always has one: the helper's whole promise is that an item is nameable,
 * and an item that somehow reached a screen without the map — raw data that skipped
 * `parseMenuItem`, a fixture written before this feature — must still show its English name
 * rather than crash a till.
 */
export interface NamedMenuItem {
  name: string
  names?: LocalizedName
}

/**
 * Builds the complete set of names from a document's `name` and its optional `names` map.
 *
 * Everything is tolerated and nothing is trusted: a missing map, a map holding a number, a
 * key for a language this build does not have. Each resolves to "no translation", which the
 * fallback below already handles — the same posture as `parseMenuItem`, which refuses a
 * malformed document rather than rendering it as `undefined`.
 */
export function parseItemNames(name: string, raw: unknown): LocalizedName {
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
 * What this item is called on a screen set to this language.
 *
 * 1. The translation for that language, when it has one.
 * 2. Otherwise English, which a valid menu item always has.
 *
 * Use it for the item as it stands **today** — the menu list, the till, the customisation
 * dialog. Never for an order that has already been placed: a line's name was snapshotted
 * when it was rung up and is the record of what the customer was told they were buying. See
 * `addToCart`.
 */
export function getLocalizedMenuItemName(item: NamedMenuItem, language: Language): string {
  const translated = item.names?.[language]?.trim()
  if (translated) return translated
  return item.names?.en.trim() || item.name.trim()
}

/**
 * The translations worth storing: trimmed, and only the ones that say something.
 *
 * Whitespace is not a translation. A name of spaces would pass a naive emptiness check and
 * then render as a blank gap on a till, so it is dropped here and the item falls back to
 * English exactly as if nothing had been typed.
 */
export function storedTranslations(names: LocalizedName): ItemNameTranslations {
  const stored: ItemNameTranslations = {}
  for (const language of TRANSLATABLE_LANGUAGES) {
    const value = names[language].trim()
    if (value !== '') stored[language] = value
  }
  return stored
}

export type ItemNamesResult = { ok: true; names: LocalizedName } | { ok: false; error: Message }

/**
 * Validates what the admin typed into the three name fields.
 *
 * English is required, because it is what every other language falls back to — an item
 * without it could not be named at all on a till set to Malay. The translations are optional
 * and held to the same maximum length as English, since they end up in the same places.
 *
 * Pure, and the same shape as `validateStaffName` and `validateVoidReason`, for the same
 * reason: it is not the control — firestore.rules is — it is what stops the form sending a
 * write the server would refuse.
 */
export function validateItemNames(draft: LocalizedName): ItemNamesResult {
  const names = Object.fromEntries(
    LANGUAGES.map((language) => [language, draft[language].trim()]),
  ) as LocalizedName

  if (names.en === '') return { ok: false, error: message('validation.itemNameRequired') }

  for (const language of LANGUAGES) {
    if (names[language].length > ITEM_NAME_MAX) {
      return { ok: false, error: message('validation.itemNameTooLong', { max: ITEM_NAME_MAX }) }
    }
  }

  return { ok: true, names }
}

/** An untouched set of fields, for the create form. */
export function emptyItemNames(): LocalizedName {
  return Object.fromEntries(LANGUAGES.map((language) => [language, ''])) as LocalizedName
}
