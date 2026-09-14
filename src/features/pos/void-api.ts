import { MessageError } from '@/features/i18n/messages'
import { doc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore'

import { validateVoidReason } from '@/features/pos/voids'
import { db } from '@/lib/firebase'

export interface VoidOrderParams {
  /** The order total being reversed, in whole sen. The rules check it against the order. */
  amount: number
  reason: string
  /**
   * The admin account whose authority this void is written under — on an admin's own void
   * their own account, on a staff-initiated one the manager who authorised it. The rules
   * require this to be the calling account, so it must match the session doing the writing.
   */
  authorizedBy: { uid: string; displayName: string }
  /**
   * The till operator who started it. The same person as the authoriser when an admin voids
   * their own sale; the staff member at the counter when a manager authorised it.
   */
  initiatedBy: { staffId: string; staffName: string }
}

/**
 * Cancels a completed sale.
 *
 * Writes `orderVoids/{orderId}` and **nothing else** — the order document is never touched,
 * which is what keeps Phase 3's immutability guarantee intact.
 *
 * Requires an admin's token, though not because of anything here: firestore.rules is what
 * enforces it, and a staff account calling this gets permission-denied from the server.
 * Voiding the same order twice also fails at the server, because the second write is an
 * update to an existing document and updates are denied — there is deliberately no
 * client-side check duplicating that.
 *
 * `firestore` is the one moving part. It defaults to the app's own session, which is the
 * admin-voids-their-own-sale path. A staff-initiated void passes the handle belonging to the
 * manager's short-lived session instead (see manager-authorization.ts), so the very same
 * writer produces both, and the record cannot differ in shape depending on who authorised it.
 */
export async function voidOrder(
  orderId: string,
  { amount, reason, authorizedBy, initiatedBy }: VoidOrderParams,
  firestore: Firestore = db,
): Promise<void> {
  const validated = validateVoidReason(reason)
  if (!validated.ok) throw new MessageError(validated.error)

  await setDoc(doc(firestore, 'orderVoids', orderId), {
    orderId,
    reason: validated.reason,
    amount,
    voidedAt: serverTimestamp(),
    voidedBy: authorizedBy.uid,
    voidedByName: authorizedBy.displayName,
    initiatedByStaffId: initiatedBy.staffId,
    initiatedByStaffName: initiatedBy.staffName,
  })
}
