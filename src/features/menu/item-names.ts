/**
 * What a menu item is called, in each language the interface speaks.
 *
 * Pure, like cart.ts and voids.ts, so the fallback rule can be tested exhaustively without a
 * browser or an emulator. The mechanics — how a `names` map is parsed, which translations are
 * worth storing, what happens when one is missing — live in localized-names.ts and are shared
 * verbatim with modifier options, so there is ONE fallback rule in this system rather than
 * one per thing a vendor can name. What is specific to a menu item, and therefore lives here,
 * is its length limit, its error messages, and the type its callers import.
 *
 * See localized-names.ts for why English stays in `name` and the map holds only translations.
 */

import type { Message } from '@/features/i18n/messages'
import type { Language } from '@/features/i18n/languages'
import {
  emptyNames,
  localizedNameOf,
  parseNames,
  storedTranslations,
  TRANSLATABLE_LANGUAGES,
  validateNames,
  type LocalizedName,
  type NamedSubject,
  type NameTranslations,
  type TranslatableLanguage,
} from '@/features/menu/localized-names'

/**
 * The longest a menu item's name may be, in any language.
 *
 * Mirrored in firestore.rules; keep the two in step. It lives here rather than in types.ts
 * because this is the module that owns what an item's name is; types.ts re-exports it, so
 * every existing import still reads the same constant.
 */
export const ITEM_NAME_MAX = 80

export { storedTranslations, TRANSLATABLE_LANGUAGES, type LocalizedName, type TranslatableLanguage }

/** What is written to Firestore for a menu item: the translations that have words in them. */
export type ItemNameTranslations = NameTranslations

/** The shape `getLocalizedMenuItemName` needs. Structural, so a test can pass a literal. */
export type NamedMenuItem = NamedSubject

/** Builds the complete set of names from a menu item's `name` and its optional `names` map. */
export function parseItemNames(name: string, raw: unknown): LocalizedName {
  return parseNames(name, raw)
}

/**
 * What this item is called on a screen set to this language: its translation, or English.
 *
 * Use it for the item as it stands **today** — the menu list, the till, the customisation
 * dialog. Never for an order that has already been placed: a line's name was snapshotted when
 * it was rung up and is the record of what the customer was told they were buying. See
 * `addToCart`.
 */
export function getLocalizedMenuItemName(item: NamedMenuItem, language: Language): string {
  return localizedNameOf(item, language)
}

export type ItemNamesResult = { ok: true; names: LocalizedName } | { ok: false; error: Message }

/** Validates the three name fields on the item form. English required, translations optional. */
export function validateItemNames(draft: LocalizedName): ItemNamesResult {
  return validateNames(draft, {
    max: ITEM_NAME_MAX,
    required: 'validation.itemNameRequired',
    tooLong: 'validation.itemNameTooLong',
  })
}

/** An untouched set of fields, for the create form. */
export function emptyItemNames(): LocalizedName {
  return emptyNames()
}
