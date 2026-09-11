import type { StaffMember } from '@/features/staff/types'

/**
 * Which identity is operating this till.
 *
 * Pure by design: the resolution rules below are where this feature can quietly go wrong
 * (a stale selection surviving a deactivation, or a roster leaving the till unable to
 * sell), so they are testable without a browser.
 */

/**
 * Per-device, which is the right scope for a shared till: a refresh mid-shift keeps the
 * operator, and another device is unaffected.
 */
export const STAFF_SESSION_STORAGE_KEY = 'ordering-system.pos.selectedStaffId'

/**
 * Someone the till can be operated as.
 *
 * Either a named staff identity from the roster, or the signed-in Firebase account itself.
 */
export interface Operator {
  id: string
  name: string
  /** True for the signed-in account's own implicit identity. */
  isSelf: boolean
}

export interface SelfIdentity {
  uid: string
  displayName: string
}

/**
 * The operators a till may be used as.
 *
 * **The signed-in account is always first, and always present.** That is deliberate and
 * load-bearing: a staff-role user cannot create staff identities, so if the roster were the
 * only source of operators, an empty or fully-deactivated roster would leave them unable to
 * sell with no way to fix it. Selling is the one thing the till must never lose.
 *
 * Named identities are therefore an *addition* — the reason a stall adds Alice and Bob is to
 * tell them apart, not to obtain permission to trade.
 */
export function buildOperators(
  self: SelfIdentity | null,
  staff: readonly StaffMember[],
): Operator[] {
  const operators: Operator[] = []

  if (self) {
    operators.push({ id: self.uid, name: self.displayName, isSelf: true })
  }

  for (const member of staff) {
    if (!member.active) continue
    // A named identity never shadows the account's own entry.
    if (self && member.id === self.uid) continue
    operators.push({ id: member.id, name: member.name, isSelf: false })
  }

  return operators
}

/**
 * Resolves a stored id against the operators currently available.
 *
 * Returns null — meaning "show the picker" — whenever the stored id is no longer offered:
 * the person was deactivated, their record was removed, or the value is junk. Revalidating
 * on every render is what stops the till carrying an identity the server would now refuse,
 * since the rules verify the operator at write time.
 */
export function resolveOperator(
  selectedId: string | null | undefined,
  operators: readonly Operator[],
): Operator | null {
  if (!selectedId) return null
  return operators.find((operator) => operator.id === selectedId) ?? null
}
