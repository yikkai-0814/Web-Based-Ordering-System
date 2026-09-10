import { doc, serverTimestamp, setDoc } from 'firebase/firestore'

import { validateVoidReason } from '@/features/pos/voids'
import { db } from '@/lib/firebase'

export interface VoidOrderParams {
  /** The order total being reversed, in whole sen. The rules check it against the order. */
  amount: number
  reason: string
  user: { uid: string; displayName: string }
}

/**
 * Cancels a completed sale.
 *
 * Writes `orderVoids/{orderId}` and **nothing else** — the order document is never touched,
 * which is what keeps Phase 3's immutability guarantee intact.
 *
 * Admin-only, though not because of anything here: firestore.rules is what enforces it, and
 * a staff account calling this gets permission-denied from the server. Voiding the same
 * order twice also fails at the server, because the second write is an update to an
 * existing document and updates are denied — there is deliberately no client-side check
 * duplicating that.
 */
export async function voidOrder(
  orderId: string,
  { amount, reason, user }: VoidOrderParams,
): Promise<void> {
  const validated = validateVoidReason(reason)
  if (!validated.ok) throw new Error(validated.error)

  await setDoc(doc(db, 'orderVoids', orderId), {
    orderId,
    reason: validated.reason,
    amount,
    voidedAt: serverTimestamp(),
    voidedBy: user.uid,
    voidedByName: user.displayName,
  })
}
