/**
 * Pure helpers for voiding a sale. No React, no Firestore — the same split as cart.ts, so
 * the rules a void must satisfy can be tested exhaustively without an emulator.
 */

/** Mirrored in firestore.rules; keep the two in step. */
export const VOID_REASON_MAX = 200

export type VoidReasonResult = { ok: true; reason: string } | { ok: false; error: string }

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
