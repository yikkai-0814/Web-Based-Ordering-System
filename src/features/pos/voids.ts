/**
 * Pure helpers for voiding a sale. No React, no Firestore — the same split as cart.ts, so
 * the rules a void must satisfy can be tested exhaustively without an emulator.
 */

import { message, type Message } from '@/features/i18n/messages'
import type { TranslationKey } from '@/features/i18n/translations/en'

/** Mirrored in firestore.rules; keep the two in step. */
export const VOID_REASON_MAX = 200

/** The id of the one choice that asks for words instead of supplying them. */
export const VOID_REASON_OTHER = 'other'

export interface VoidReasonPreset {
  /** Stable, English, and never stored — it identifies the row, not the record. */
  id: string
  labelKey: TranslationKey
}

/**
 * The reasons a sale is voided on an ordinary day, in the order they come up.
 *
 * They exist so that the common case is a tap rather than a sentence typed on a touch
 * keyboard at a counter with somebody waiting. Typing is still there, under "Other", and a
 * reason is still required either way — the record has to say why the money went back.
 *
 * What gets written is the label as the operator read it, translated into the language the
 * till is set to. That is exactly what a typed reason has always been: a human sentence,
 * stored verbatim and shown verbatim, never matched against or aggregated. Storing an id
 * instead would make the reason a code the rules and every reader would have to learn.
 */
export const VOID_REASON_PRESETS: readonly VoidReasonPreset[] = [
  { id: 'customer-changed-mind', labelKey: 'void.reasonCustomerChangedMind' },
  { id: 'wrong-order', labelKey: 'void.reasonWrongOrder' },
  { id: 'wrong-item', labelKey: 'void.reasonWrongItem' },
  { id: 'duplicate-order', labelKey: 'void.reasonDuplicateOrder' },
  { id: 'payment-issue', labelKey: 'void.reasonPaymentIssue' },
  { id: 'item-unavailable', labelKey: 'void.reasonItemUnavailable' },
  { id: 'staff-mistake', labelKey: 'void.reasonStaffMistake' },
]

/** The preset with this id, or null for "Other", an empty choice, or an id from an older build. */
export function findVoidReasonPreset(id: string): VoidReasonPreset | null {
  return VOID_REASON_PRESETS.find((preset) => preset.id === id) ?? null
}

export type VoidReasonResult = { ok: true; reason: string } | { ok: false; error: Message }

export type ManagerCredentialsResult =
  { ok: true; email: string; password: string } | { ok: false; error: Message }

/**
 * Checks that a manager actually filled the authorisation form in.
 *
 * Emphatically NOT an authorisation check — it decides nothing about whether these
 * credentials are a manager's, which only Firebase Auth and firestore.rules can answer. All
 * it does is save a round trip, and give a clearer message than `auth/missing-password`
 * when a field was left blank. The shape of the address is left to Firebase: a client-side
 * email regex would reject valid addresses without making anything safer.
 */
export function validateManagerCredentials(
  email: string,
  password: string,
): ManagerCredentialsResult {
  const trimmed = email.trim()

  if (trimmed === '') {
    return { ok: false, error: message('validation.managerEmailRequired') }
  }
  if (password === '') {
    return { ok: false, error: message('validation.managerPasswordRequired') }
  }

  return { ok: true, email: trimmed, password }
}

/**
 * Validates the reason an admin gives for voiding a sale.
 *
 * A reason is required, not optional. The void record is the only trace that money was
 * reversed, so "why" is the part that makes it an audit trail rather than a hole in the
 * takings. The trimmed value is returned so callers store what was validated rather than
 * the raw input.
 */
export function validateVoidReason(input: string): VoidReasonResult {
  const trimmed = input.trim()

  if (trimmed === '') {
    return { ok: false, error: message('validation.voidReasonRequired') }
  }
  if (trimmed.length > VOID_REASON_MAX) {
    return { ok: false, error: message('validation.voidReasonTooLong', { max: VOID_REASON_MAX }) }
  }

  return { ok: true, reason: trimmed }
}

/**
 * Turns what the dialog collected — a choice, and the words typed under "Other" — into the
 * one string that gets written.
 *
 * Kept here rather than in the component for the same reason everything else in this file
 * is: the question "does this void have a usable reason?" is answered identically whichever
 * path was taken, and that is worth testing without a browser.
 *
 * Both paths end at `validateVoidReason`, so the required-and-not-too-long rule the record
 * has always been held to is applied once, not twice in slightly different ways.
 */
export function resolveVoidReason(
  presetId: string,
  presetLabel: string,
  customReason: string,
): VoidReasonResult {
  if (presetId === '') {
    return { ok: false, error: message('validation.voidReasonNotSelected') }
  }
  if (presetId === VOID_REASON_OTHER) {
    return validateVoidReason(customReason)
  }
  return validateVoidReason(presetLabel)
}

/**
 * Keys voids by the order they cancel, so a list of orders can be rendered without a
 * nested lookup per row.
 *
 * Generic over the record shape: it only needs `orderId`, which keeps this file free of
 * any dependency on the Firestore types.
 */
export function indexVoidsByOrderId<T extends { orderId: string }>(
  voids: readonly T[],
): Map<string, T> {
  const index = new Map<string, T>()
  for (const entry of voids) index.set(entry.orderId, entry)
  return index
}

/** True when a void exists for this order. */
export function isVoided(orderId: string, index: ReadonlyMap<string, unknown>): boolean {
  return index.has(orderId)
}
