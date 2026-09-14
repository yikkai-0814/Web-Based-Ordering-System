import type { TranslationKey } from '@/features/i18n/translations/en'

/**
 * A translatable message, produced away from the interface and rendered inside it.
 *
 * The pure modules — cart.ts, voids.ts, money.ts, modifiers.ts and the rest — decide *what*
 * went wrong. They deliberately know nothing about React, about which language is selected,
 * or about how a sentence is worded, so they return one of these instead of prose, and the
 * component that shows it calls `t`.
 *
 * That split is what keeps them pure and exhaustively testable without a browser, and it has
 * a second benefit: a test asserting `error.key === 'validation.cartEmpty'` is checking the
 * rule, where one asserting on the sentence was checking the copywriting.
 */
export interface Message {
  key: TranslationKey
  /**
   * Values spliced into the sentence.
   *
   * **Vendor-entered text travels here and nowhere else.** A menu item's name, a modifier
   * group's name, a staff member's name: they are inserted verbatim, never looked up, never
   * case-folded. `key` is a union of literal keys, so `t(item.name)` will not compile —
   * which is what makes "user data is not translated" a property of the types rather than a
   * rule somebody has to remember.
   */
  params?: MessageParams
}

export type MessageParams = Record<string, string | number>

/** Builds a message. A function rather than an object literal so call sites stay short. */
export function message(key: TranslationKey, params?: MessageParams): Message {
  return params ? { key, params } : { key }
}

/**
 * Fills `{{placeholders}}` in a template.
 *
 * A placeholder with no matching parameter is left exactly as it is rather than blanked: a
 * visible `{{name}}` on screen is a bug report, where an empty gap is a mystery.
 */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

/**
 * An error whose text is a translatable message.
 *
 * The write APIs validate before they touch Firestore and throw when the cart, the placement
 * or the reason is not usable. They are as language-blind as the pure modules they call, so
 * they throw one of these and the dialog that catches it decides how to say it.
 *
 * `Error.message` is filled with the key rather than left blank, so an uncaught one still
 * says something useful in a stack trace.
 */
export class MessageError extends Error {
  readonly detail: Message

  constructor(detail: Message) {
    super(detail.key)
    this.name = 'MessageError'
    this.detail = detail
  }
}

/** Narrows a caught value to one of ours, so a UI can translate it. */
export function isMessageError(value: unknown): value is MessageError {
  return value instanceof MessageError
}
