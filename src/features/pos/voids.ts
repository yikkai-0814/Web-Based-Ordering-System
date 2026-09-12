/**
 * Pure helpers for voiding a sale. No React, no Firestore — the same split as cart.ts, so
 * the rules a void must satisfy can be tested exhaustively without an emulator.
 */

/** Mirrored in firestore.rules; keep the two in step. */
export const VOID_REASON_MAX = 200

export type VoidReasonResult = { ok: true; reason: string } | { ok: false; error: string }

export type ManagerCredentialsResult =
  { ok: true; email: string; password: string } | { ok: false; error: string }

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
    return { ok: false, error: "Enter the manager's email address." }
  }
  if (password === '') {
    return { ok: false, error: "Enter the manager's password." }
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
    return { ok: false, error: 'Enter a reason for voiding this sale.' }
  }
  if (trimmed.length > VOID_REASON_MAX) {
    return { ok: false, error: `Reasons can be at most ${VOID_REASON_MAX} characters.` }
  }

  return { ok: true, reason: trimmed }
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
