import { doc, serverTimestamp, setDoc } from 'firebase/firestore'

import { changeDue } from '@/features/pos/cart'
import type { PaymentMethod } from '@/features/pos/types'
import { db } from '@/lib/firebase'

export interface RecordPaymentParams {
  method: PaymentMethod
  /** The order total being settled, in whole sen. The rules check it against the order. */
  amount: number
  /** Whole sen for a cash payment; null for e-wallet. */
  cashTendered: number | null
  /** The signed-in Firebase account. Rules require paidBy to equal this uid. */
  user: { uid: string; displayName: string }
  /**
   * The POS operator taking the money. Separate from `user` on purpose, exactly as on an
   * order: one shared login serves the whole shift, so the account cannot say who was at
   * the counter.
   *
   * When nobody has been selected — an admin settling an order from the office, say — the
   * caller passes the signed-in account's own identity, which the rules accept as the
   * self-operator form. See `payerFor` in OrderDetailPage.
   */
  staff: { id: string; name: string }
}

/**
 * Records money received for an order.
 *
 * Writes `orderPayments/{orderId}` and **nothing else** — the order document is never
 * touched, which is what keeps its immutability guarantee intact. The same shape as
 * `voidOrder`, for the same reason.
 *
 * Change is computed here with `changeDue`, the one function that does this arithmetic, so
 * an under-payment is refused before it reaches Firestore. The rules recompute it anyway
 * (`changeGiven == cashTendered - amount`), because a client-side check is not a control.
 *
 * Paying an order twice fails at the server rather than here: `setDoc` on a document that
 * already exists is an update, and updates to a payment are denied. Paying a voided order
 * fails there too. Neither check is duplicated client-side as enforcement — `canRecordPayment`
 * in payments.ts hides the button, which is a different job.
 */
export async function recordPayment(
  orderId: string,
  { method, amount, cashTendered, user, staff }: RecordPaymentParams,
): Promise<void> {
  let change: number | null = null

  if (method === 'cash') {
    if (cashTendered === null) throw new Error('Enter the amount received.')
    const result = changeDue(amount, cashTendered)
    if (!result.ok) throw new Error(result.error)
    change = result.change
  } else if (cashTendered !== null) {
    throw new Error('Only cash payments record an amount received.')
  }

  await setDoc(doc(db, 'orderPayments', orderId), {
    orderId,
    method,
    amount,
    cashTendered: method === 'cash' ? cashTendered : null,
    changeGiven: change,
    paidAt: serverTimestamp(),
    paidBy: user.uid,
    paidByName: user.displayName,
    // The rules check this identity exists, is active, and that the name matches theirs
    // right now — so the snapshot is provably accurate at the moment money changed hands.
    paidByStaffId: staff.id,
    paidByStaffName: staff.name,
  })
}
