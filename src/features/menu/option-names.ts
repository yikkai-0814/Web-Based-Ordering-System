/**
 * What a modifier option is called, in each language the interface speaks.
 *
 * "Fried Egg" on an English till, "Telur Goreng" on a Malay one, "煎蛋" on a Chinese one —
 * the same option, named by the vendor in up to three languages and stored the same way a
 * menu item's name already is. The shared mechanics live in localized-names.ts; this module
 * adds only what is specific to an option: its length limit and its error messages.
 *
 * Two things about options in particular are worth stating here.
 *
 * **Options live inside their group's document, in a list.** Firestore rules cannot iterate a
 * list, so — exactly as with an option's `name` and `priceAdjustment`, which have never been
 * checked there either — the rules validate the group around them and this module validates
 * what is inside. `parseModifierGroup` is the read-side half of that: a `names` map holding a
 * number, a key for a language this build does not have, or an `en` that should never have
 * been written all resolve to "no translation" rather than to a gap on a till.
 *
 * **A chosen option's name on an order is not read through here.** It was snapshotted by
 * `selectionOf` at the moment of sale, in the language the till was then speaking, and is the
 * record of what the customer was told they were buying. Retranslating the option afterwards
 * changes what the next customer is offered and nothing that has already been rung up.
 */

import type { Language } from '@/features/i18n/languages'
import type { Message } from '@/features/i18n/messages'
import {
  emptyNames,
  localizedNameOf,
  parseNames,
  storedTranslations,
  translationCount,
  validateNames,
  type LocalizedName,
  type NamedSubject,
  type NameTranslations,
} from '@/features/menu/localized-names'

/**
 * The longest a modifier option's name may be, in any language.
 *
 * The limit English has always been held to, applied unchanged to the translations: they are
 * shown in the same buttons on the same customisation dialog, so a Malay name that would not
 * fit is no more usable than an English one. Defined here, beside the rest of what an option's
 * name is, and re-exported from modifiers.ts so every existing import still reads it there.
 */
export const MODIFIER_OPTION_NAME_MAX = 60

/** What is written into an option: the translations that have words in them, never English. */
export type OptionNameTranslations = NameTranslations

/** The shape `getLocalizedModifierOptionName` needs. Structural, so a test can pass a literal. */
export type NamedModifierOption = NamedSubject

/** Builds an option's complete set of names from its `name` and its optional `names` map. */
export function parseOptionNames(name: string, raw: unknown): LocalizedName {
  return parseNames(name, raw)
}

/**
 * What this option is called on a screen set to this language.
 *
 * 1. The translation for that language, when it has one.
 * 2. Otherwise the canonical English `name`, which a valid option always has.
 *
 * The one place that decision is made. No component compares languages itself, which is what
 * keeps "a missing translation falls back, it never renders blank" a property of the system
 * rather than a habit.
 */
export function getLocalizedModifierOptionName(
  option: NamedModifierOption,
  language: Language,
): string {
  return localizedNameOf(option, language)
}

export type OptionNamesResult =
  { ok: true; name: string; names: OptionNameTranslations } | { ok: false; error: Message }

/**
 * Validates one option's English name and its translations together.
 *
 * Takes them separately because that is how the editor holds them: English stays in the row's
 * own Name input, where it has always been edited, and the translations are typed in a dialog
 * behind it. What comes back is what should be written — English trimmed, and the translations
 * trimmed with the blank and the whitespace-only ones dropped.
 */
export function validateOptionNames(
  name: string,
  names: OptionNameTranslations,
): OptionNamesResult {
  const draft: LocalizedName = { ...emptyNames(), ...names, en: name }
  const result = validateNames(draft, {
    max: MODIFIER_OPTION_NAME_MAX,
    required: 'modifierAdmin.needOptionName',
    tooLong: 'validation.optionNameTooLong',
  })
  if (!result.ok) return result

  return { ok: true, name: result.names.en, names: storedTranslations(result.names) }
}

/** The translations of an option as it stands, for seeding the dialog. Never includes English. */
export function optionTranslationsOf(option: NamedModifierOption): OptionNameTranslations {
  return option.names ? storedTranslations(option.names) : {}
}

/** Defined in localized-names.ts, which both translatable things share. Re-exported here. */
export { translationCount }
