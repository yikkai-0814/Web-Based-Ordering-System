import { MessageError } from '@/features/i18n/messages'
import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore'

import { cartTotal, validateCart, type Cart } from '@/features/pos/cart'
import { validatePlacement, type OrderType } from '@/features/pos/order-type'
import { businessDateOf } from '@/features/pos/types'
import { db } from '@/lib/firebase'

export interface CreateOrderParams {
  cart: Cart
  /**
   * How the order is served, raw as the till holds it. Validated here rather than trusted,
   * so `createOrder` stays the single place an order's shape is decided.
   *
   * `tableNumber` is the text typed into the field; it is ignored entirely for a takeaway.
   */
  placement: { orderType: OrderType; tableNumber: string }
  /** The signed-in Firebase account. Rules require createdBy to equal this uid. */
  user: { uid: string; displayName: string }
  /**
   * The staff identity operating the till. Separate from `user` on purpose: one shared
   * login serves the whole shift, so the account cannot say who rang the sale up.
   */
  staff: { id: string; name: string }
}

export interface CreatedOrder {
  id: string
  number: number
}

/**
 * Records a sale. **Creates it unpaid** — taking the money is a separate step.
 *
 * Nothing about payment is written here, and the rules refuse an order that carries a
 * payment method, tendered amount or change. That is what stops a client declaring its own
 * sale paid at creation and bypassing `recordPayment`, whose document is the only thing
 * that settles an order. See payment-api.ts and firestore.rules.
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
  placement,
  user,
  staff,
}: CreateOrderParams): Promise<CreatedOrder> {
  const validation = validateCart(cart)
  if (!validation.ok) throw new MessageError(validation.error)

  // A dine-in order without a usable table number never reaches Firestore. The rules check
  // it again, independently — this is the message the counter sees, not the enforcement.
  const service = validatePlacement(placement.orderType, placement.tableNumber)
  if (!service.ok) throw new MessageError(service.error)

  const total = cartTotal(cart)

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
      // Lines are stored as plain snapshots — no reference back to the menu item, and none
      // back to its customisation configuration either. `lineId` is deliberately NOT
      // written: it is derived from the menu item and the chosen options, so an order that
      // stored it could disagree with itself. Rendering re-derives it with the same
      // function the cart merges on (see lineKeyOf).
      lines: cart.map((line) => ({
        menuItemId: line.menuItemId,
        name: line.name,
        basePrice: line.basePrice,
        unitPrice: line.unitPrice,
        modifiers: line.modifiers.map((modifier) => ({
          groupId: modifier.groupId,
          groupName: modifier.groupName,
          optionId: modifier.optionId,
          optionName: modifier.optionName,
          priceAdjustment: modifier.priceAdjustment,
        })),
        quantity: line.quantity,
      })),
      total,
      orderType: service.orderType,
      // Conditional spread, never `tableNumber: null` or `undefined`. The rules refuse the
      // KEY on a takeaway order, and Firestore rejects an undefined field value outright
      // rather than omitting it — so this is what makes "absent" actually absent.
      ...(service.orderType === 'dine_in' ? { tableNumber: service.tableNumber } : {}),
      // No payment fields, by design — see the note above. An order is unpaid until an
      // orderPayments document says otherwise.
      createdAt: serverTimestamp(),
      createdBy: user.uid,
      createdByName: user.displayName,
      // The rules check this member exists, is active, and that the name matches theirs
      // right now — so the snapshot is provably accurate at the moment of sale.
      staffId: staff.id,
      staffName: staff.name,
    })

    return next
  })

  return { id: orderReference.id, number }
}
