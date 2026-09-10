import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore'

import { cartTotal, changeDue, validateCart, type Cart } from '@/features/pos/cart'
import { businessDateOf, type PaymentMethod } from '@/features/pos/types'
import { db } from '@/lib/firebase'

export interface CreateOrderParams {
  cart: Cart
  paymentMethod: PaymentMethod
  /** Whole sen for a cash sale; null for e-wallet. */
  cashTendered: number | null
  user: { uid: string; displayName: string }
}

export interface CreatedOrder {
  id: string
  number: number
}

/**
 * Records a sale.
 *
 * The order number and the order itself are written in **one transaction**: the day's
 * counter is read, advanced by exactly one, and the order stamped with the new number. Two
 * tills ringing up simultaneously cannot therefore hand out the same number — the loser of
 * the race retries against the updated counter.
 *
 * Throughput note: every sale on a given day touches a single counter document, which
 * Firestore sustains at roughly one write per second. That is far above a café counter's
 * rate, but it is the ceiling of this design.
 */
export async function createOrder({
  cart,
  paymentMethod,
  cashTendered,
  user,
}: CreateOrderParams): Promise<CreatedOrder> {
  const validation = validateCart(cart)
  if (!validation.ok) throw new Error(validation.error)

  const total = cartTotal(cart)

  let change: number | null = null
  if (paymentMethod === 'cash') {
    if (cashTendered === null) throw new Error('Enter the amount tendered.')
    const result = changeDue(total, cashTendered)
    if (!result.ok) throw new Error(result.error)
    change = result.change
  } else if (cashTendered !== null) {
    throw new Error('Only cash sales record an amount tendered.')
  }

  const businessDate = businessDateOf(new Date())
  const counterReference = doc(db, 'counters', businessDate)
  const orderReference = doc(collection(db, 'orders'))

  const number = await runTransaction(db, async (transaction) => {
    const counter = await transaction.get(counterReference)
    const lastNumber = counter.exists() ? Number(counter.data().lastNumber) : 0
    const next = lastNumber + 1

    if (counter.exists()) {
      transaction.update(counterReference, { lastNumber: next })
    } else {
      transaction.set(counterReference, { lastNumber: 1 })
    }

    transaction.set(orderReference, {
      number: next,
      businessDate,
      // Lines are stored as plain snapshots — no reference back to the menu item.
      lines: cart.map((line) => ({
        menuItemId: line.menuItemId,
        name: line.name,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
      })),
      total,
      paymentMethod,
      cashTendered: paymentMethod === 'cash' ? cashTendered : null,
      changeGiven: change,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
      createdByName: user.displayName,
    })

    return next
  })

  return { id: orderReference.id, number }
}
