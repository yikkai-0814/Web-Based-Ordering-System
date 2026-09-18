/**
 * The write boundary, exercised through the functions the app actually calls.
 *
 * Every other suite stops short of this. The unit tests cover the pure logic these APIs
 * lean on; the rules tests cover what the database will accept, but they hand-build the
 * documents, so a rule and an API could disagree about a field name and both suites would
 * still be green. Here the API writes the document and the assertions read back what
 * landed — which makes the API's own field names, batching and transaction the thing under
 * test.
 */
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createMenuItem, deleteMenuItem, updateMenuItem } from '@/features/menu/menu-api'
import { getLocalizedMenuItemName } from '@/features/menu/item-names'
import { parseMenuItem } from '@/features/menu/types'
import type { Cart } from '@/features/pos/cart'
import { lineKeyOf, parseModifierGroup, selectionOf } from '@/features/menu/modifiers'
import { getLocalizedModifierOptionName } from '@/features/menu/option-names'
import {
  createModifierGroupForItem,
  deleteModifierGroup,
  updateModifierGroup,
  type ModifierGroupInput,
} from '@/features/menu/menu-api'
import { modifierCostKey } from '@/features/menu/modifier-cost'
import { addToCart, EMPTY_CART } from '@/features/pos/cart'
import type { FulfillmentStatus } from '@/features/pos/fulfillment'
import {
  correctFulfillment,
  FULFILLMENT_ORIGIN,
  setFulfillment,
} from '@/features/pos/fulfillment-api'
import {
  NOT_A_MANAGER_MESSAGE,
  withManagerAuthorization,
} from '@/features/pos/manager-authorization'
import { recordPayment } from '@/features/pos/payment-api'
import { createOrder } from '@/features/pos/pos-api'
import { businessDateOf } from '@/features/pos/types'
import { voidOrder } from '@/features/pos/void-api'
import { createStaffMember, renameStaffMember, setStaffActive } from '@/features/staff/staff-api'
import { auth, db } from '@/lib/firebase'

import {
  ACCOUNT_PASSWORD,
  createAccount,
  resetEmulators,
  seed,
  signInAs,
  startHarness,
  stopHarness,
  type TestAccount,
} from './harness'

let admin: TestAccount
let staff: TestAccount

/** A cart of two lines: RM 12.50 x2 and RM 6.90 x1 = RM 31.90. */
const CART: Cart = [
  cartLine('item-flat-white', 'Flat White', 1250, 2),
  cartLine('item-croissant', 'Croissant', 690, 1),
]
const CART_TOTAL = 3190

/** A line with no customisation, built the way addToCart would build it. */
function cartLine(menuItemId: string, name: string, unitPrice: number, quantity: number) {
  return {
    lineId: lineKeyOf({ menuItemId, modifiers: [] }),
    menuItemId,
    name,
    basePrice: unitPrice,
    unitPrice,
    modifiers: [],
    quantity,
  }
}

const DINE_IN = { orderType: 'dine_in' as const, tableNumber: '5' }
const TAKEAWAY = { orderType: 'takeaway' as const, tableNumber: '' }

const asUser = (account: TestAccount) => ({
  uid: account.uid,
  displayName: account.displayName,
})

/** The self-operator form: the signed-in account standing in as the till operator. */
const asOperator = (account: TestAccount) => ({ id: account.uid, name: account.displayName })

/** The same identity as a void's initiator, which names its fields differently. */
const asInitiator = (account: TestAccount) => ({
  staffId: account.uid,
  staffName: account.displayName,
})

interface ManagerCredentials {
  email: string
  password: string
}

beforeAll(async () => {
  await startHarness()
})

afterAll(async () => {
  await stopHarness()
})

beforeEach(async () => {
  await resetEmulators()
  // The email is generated per run by the harness; only the display name matters here,
  // because that is what the rules check an order's createdByName against.
  admin = await createAccount('admin', 'Ada Admin', 'admin')
  staff = await createAccount('staff', 'Sam Staff', 'staff')
  await seed(async (context) => {
    const seedDb = context.firestore()
    await setDoc(doc(seedDb, 'menuItems', 'item-flat-white'), {
      name: 'Flat White',
      categoryId: 'cat-coffee',
      price: 1250,
      sortOrder: 1,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })
})

afterEach(async () => {
  await resetEmulators()
})

describe('createOrder writes what the rules expect', () => {
  it('rings up a dine-in sale and numbers it from the day’s counter', async () => {
    await signInAs(staff)
    const created = await createOrder({
      cart: CART,
      placement: DINE_IN,
      user: asUser(staff),
      staff: asOperator(staff),
    })

    expect(created.number).toBe(1)

    const order = await getDoc(doc(db, 'orders', created.id))
    expect(order.exists()).toBe(true)
    expect(order.get('total')).toBe(CART_TOTAL)
    expect(order.get('orderType')).toBe('dine_in')
    expect(order.get('tableNumber')).toBe('5')
    expect(order.get('businessDate')).toBe(businessDateOf(new Date()))
    // The account name is now checked against the profile, so this landing at all proves
    // createOrder sends the name the profile holds and not something of its own.
    expect(order.get('createdByName')).toBe('Sam Staff')
    expect(order.get('createdBy')).toBe(staff.uid)

    // The counter advanced in the same transaction.
    const counter = await getDoc(doc(db, 'counters', businessDateOf(new Date())))
    expect(counter.get('lastNumber')).toBe(1)
  })

  it('omits tableNumber entirely for a takeaway, rather than writing it empty', async () => {
    await signInAs(staff)
    const created = await createOrder({
      cart: CART,
      placement: TAKEAWAY,
      user: asUser(staff),
      staff: asOperator(staff),
    })

    const order = await getDoc(doc(db, 'orders', created.id))
    expect(order.get('orderType')).toBe('takeaway')
    // Absent, not null — the rules refuse the key at all on a takeaway, so a null here
    // would have been rejected rather than stored.
    expect(Object.keys(order.data() ?? {})).not.toContain('tableNumber')
  })

  it('numbers consecutive sales 1, 2, 3 within the same day', async () => {
    await signInAs(staff)
    const numbers: number[] = []
    for (let index = 0; index < 3; index += 1) {
      const created = await createOrder({
        cart: CART,
        placement: TAKEAWAY,
        user: asUser(staff),
        staff: asOperator(staff),
      })
      numbers.push(created.number)
    }
    expect(numbers).toEqual([1, 2, 3])
  })

  it('attributes a sale to a named roster member, not only to the login', async () => {
    await signInAs(admin)
    const rosterId = await createStaffMember('Alice')

    await signInAs(staff)
    const created = await createOrder({
      cart: CART,
      placement: DINE_IN,
      user: asUser(staff),
      staff: { id: rosterId, name: 'Alice' },
    })

    const order = await getDoc(doc(db, 'orders', created.id))
    // Two identities on one sale: the credential used, and the person who used it.
    expect(order.get('createdByName')).toBe('Sam Staff')
    expect(order.get('staffName')).toBe('Alice')
    expect(order.get('staffId')).toBe(rosterId)
  })
})

describe('recordPayment settles an order without touching it', () => {
  async function placeOrder(): Promise<string> {
    await signInAs(staff)
    const created = await createOrder({
      cart: CART,
      placement: DINE_IN,
      user: asUser(staff),
      staff: asOperator(staff),
    })
    return created.id
  }

  it('records cash with the change it computed', async () => {
    const orderId = await placeOrder()
    await recordPayment(orderId, {
      method: 'cash',
      amount: CART_TOTAL,
      cashTendered: 5000,
      user: asUser(staff),
      staff: asOperator(staff),
    })

    const payment = await getDoc(doc(db, 'orderPayments', orderId))
    expect(payment.get('method')).toBe('cash')
    expect(payment.get('amount')).toBe(CART_TOTAL)
    expect(payment.get('cashTendered')).toBe(5000)
    expect(payment.get('changeGiven')).toBe(5000 - CART_TOTAL)
    expect(payment.get('paidByName')).toBe('Sam Staff')

    // The order itself is untouched — the guarantee the whole sidecar design exists for.
    const order = await getDoc(doc(db, 'orders', orderId))
    expect(Object.keys(order.data() ?? {})).not.toContain('paymentMethod')
  })

  it('records e-wallet with the cash fields null rather than missing', async () => {
    const orderId = await placeOrder()
    await recordPayment(orderId, {
      method: 'ewallet',
      amount: CART_TOTAL,
      cashTendered: null,
      user: asUser(staff),
      staff: asOperator(staff),
    })

    const payment = await getDoc(doc(db, 'orderPayments', orderId))
    expect(payment.get('cashTendered')).toBeNull()
    expect(payment.get('changeGiven')).toBeNull()
  })

  it('refuses to pay the same order twice', async () => {
    const orderId = await placeOrder()
    const payment = {
      method: 'cash' as const,
      amount: CART_TOTAL,
      cashTendered: 5000,
      user: asUser(staff),
      staff: asOperator(staff),
    }
    await recordPayment(orderId, payment)
    // Not a check anybody wrote: the second write is an update, and updates are denied.
    await expect(recordPayment(orderId, payment)).rejects.toThrow()
  })

  it('refuses an under-payment before it reaches the database', async () => {
    const orderId = await placeOrder()
    await expect(
      recordPayment(orderId, {
        method: 'cash',
        amount: CART_TOTAL,
        cashTendered: 1000,
        user: asUser(staff),
        staff: asOperator(staff),
      }),
    ).rejects.toThrow('validation.tenderedTooLittle')
  })
})

describe('setFulfillment moves an order and journals every step', () => {
  async function placeOrder(): Promise<string> {
    await signInAs(staff)
    const created = await createOrder({
      cart: CART,
      placement: DINE_IN,
      user: asUser(staff),
      staff: asOperator(staff),
    })
    return created.id
  }

  it('writes the status and its journal entry in one batch', async () => {
    const orderId = await placeOrder()
    await setFulfillment(orderId, {
      from: FULFILLMENT_ORIGIN,
      to: 'preparing',
      user: asUser(staff),
      staff: asOperator(staff),
    })

    const record = await getDoc(doc(db, 'orderFulfillment', orderId))
    expect(record.get('status')).toBe('preparing')
    expect(record.get('updatedByName')).toBe('Sam Staff')

    const journal = await getDocs(collection(db, 'orderFulfillment', orderId, 'transitions'))
    expect(journal.size).toBe(1)
    expect(journal.docs[0]?.get('from')).toBe('pending')
    expect(journal.docs[0]?.get('to')).toBe('preparing')
  })

  it('walks pending to delivered, one journal entry per step', async () => {
    const orderId = await placeOrder()
    const steps = [
      [FULFILLMENT_ORIGIN, 'preparing'],
      ['preparing', 'ready'],
      ['ready', 'delivered'],
    ] as const

    for (const [from, to] of steps) {
      await setFulfillment(orderId, {
        from,
        to,
        user: asUser(staff),
        staff: asOperator(staff),
      })
    }

    const record = await getDoc(doc(db, 'orderFulfillment', orderId))
    expect(record.get('status')).toBe('delivered')
    const journal = await getDocs(collection(db, 'orderFulfillment', orderId, 'transitions'))
    expect(journal.size).toBe(3)
  })

  it('refuses to skip a step', async () => {
    const orderId = await placeOrder()
    await expect(
      setFulfillment(orderId, {
        from: FULFILLMENT_ORIGIN,
        to: 'delivered',
        user: asUser(staff),
        staff: asOperator(staff),
      }),
    ).rejects.toThrow()
  })

  it('2. lets STAFF step one place back, and journals the correction', async () => {
    const orderId = await placeOrder()
    await setFulfillment(orderId, {
      from: FULFILLMENT_ORIGIN,
      to: 'preparing',
      user: asUser(staff),
      staff: asOperator(staff),
    })

    await correctFulfillment(orderId, {
      from: 'preparing',
      to: FULFILLMENT_ORIGIN,
      user: asUser(staff),
      staff: asOperator(staff),
    })

    const record = await getDoc(doc(db, 'orderFulfillment', orderId))
    expect(record.get('status')).toBe('pending')
    // Rewound in status, but not in the trail: the correction is a step like any other.
    const journal = await getDocs(collection(db, 'orderFulfillment', orderId, 'transitions'))
    expect(journal.size).toBe(2)
  })

  /**
   * 7. The same call, from an admin, through the app's own API.
   *
   * The rules suite proves the database refuses it. This proves the refusal reaches the code
   * path the app actually uses — `correctFulfillment` has no role check of its own, by
   * design, so what stops an admin here is the server and nothing else.
   */
  it('7. refuses an ADMIN the very step it just allowed staff', async () => {
    const orderId = await placeOrder()
    await setFulfillment(orderId, {
      from: FULFILLMENT_ORIGIN,
      to: 'preparing',
      user: asUser(staff),
      staff: asOperator(staff),
    })

    await signInAs(admin)
    await expect(
      correctFulfillment(orderId, {
        from: 'preparing',
        to: FULFILLMENT_ORIGIN,
        user: asUser(admin),
        staff: asOperator(admin),
      }),
    ).rejects.toThrow()

    // Unmoved: still where the counter left it.
    expect((await getDoc(doc(db, 'orderFulfillment', orderId))).get('status')).toBe('preparing')
  })

  it('7. refuses an ADMIN driving the workflow forward', async () => {
    const orderId = await placeOrder()

    await signInAs(admin)
    await expect(
      setFulfillment(orderId, {
        from: FULFILLMENT_ORIGIN,
        to: 'preparing',
        user: asUser(admin),
        staff: asOperator(admin),
      }),
    ).rejects.toThrow()

    // Nothing was created at all — pending is the absence of this document.
    expect((await getDoc(doc(db, 'orderFulfillment', orderId))).exists()).toBe(false)
  })

  it('9. still lets an admin READ the order and its fulfilment', async () => {
    const orderId = await placeOrder()
    for (const [from, to] of [
      [FULFILLMENT_ORIGIN, 'preparing'],
      ['preparing', 'ready'],
    ] as const) {
      await setFulfillment(orderId, { from, to, user: asUser(staff), staff: asOperator(staff) })
    }

    await signInAs(admin)
    expect((await getDoc(doc(db, 'orders', orderId))).exists()).toBe(true)
    expect((await getDoc(doc(db, 'orderFulfillment', orderId))).get('status')).toBe('ready')
    const journal = await getDocs(collection(db, 'orderFulfillment', orderId, 'transitions'))
    expect(journal.size).toBe(2)
  })

  it('4, 11. steps ready back to preparing, clearing readyAt and leaving the clock alone', async () => {
    const orderId = await placeOrder()
    for (const [from, to] of [
      [FULFILLMENT_ORIGIN, 'preparing'],
      ['preparing', 'ready'],
    ] as const) {
      await setFulfillment(orderId, { from, to, user: asUser(staff), staff: asOperator(staff) })
    }
    const ready = await getDoc(doc(db, 'orderFulfillment', orderId))
    expect(ready.get('status')).toBe('ready')
    expect(ready.get('readyAt')).not.toBeNull()

    await correctFulfillment(orderId, {
      from: 'ready',
      to: 'preparing',
      user: asUser(staff),
      staff: asOperator(staff),
    })

    const back = await getDoc(doc(db, 'orderFulfillment', orderId))
    expect(back.get('status')).toBe('preparing')
    // It is being worked on again, so it no longer claims a finish time...
    expect(back.get('readyAt')).toBeNull()
    // ...and it was never delivered, so the customer's clock has not been stopped at any
    // point. The timer is createdAt -> deliveredAt and neither end moved.
    expect(back.get('deliveredAt')).toBeNull()
  })

  it('6, 8, 11. refuses BOTH roles delivered → ready, leaving the stamps untouched', async () => {
    const orderId = await placeOrder()
    for (const [from, to] of [
      [FULFILLMENT_ORIGIN, 'preparing'],
      ['preparing', 'ready'],
      ['ready', 'delivered'],
    ] as const) {
      await setFulfillment(orderId, { from, to, user: asUser(staff), staff: asOperator(staff) })
    }
    const delivered = await getDoc(doc(db, 'orderFulfillment', orderId))
    const handedOverAt = delivered.get('deliveredAt')
    const finishedAt = delivered.get('readyAt')
    expect(handedOverAt).not.toBeNull()

    // The counter that delivered it cannot take it back...
    await expect(
      correctFulfillment(orderId, {
        from: 'delivered',
        to: 'ready',
        user: asUser(staff),
        staff: asOperator(staff),
      }),
    ).rejects.toThrow()

    // ...and neither can the back office, which is the change: there is no longer any
    // account for which this succeeds.
    await signInAs(admin)
    await expect(
      correctFulfillment(orderId, {
        from: 'delivered',
        to: 'ready',
        user: asUser(admin),
        staff: asOperator(admin),
      }),
    ).rejects.toThrow()

    const after = await getDoc(doc(db, 'orderFulfillment', orderId))
    expect(after.get('status')).toBe('delivered')
    // Both refusals wrote nothing, so the timer is still stopped where the handover put it.
    expect(after.get('deliveredAt')).toEqual(handedOverAt)
    expect(after.get('readyAt')).toEqual(finishedAt)
  })

  it('leaves payment untouched when fulfilment is reversed', async () => {
    const orderId = await placeOrder()
    for (const [from, to] of [
      [FULFILLMENT_ORIGIN, 'preparing'],
      ['preparing', 'ready'],
    ] as const) {
      await setFulfillment(orderId, { from, to, user: asUser(staff), staff: asOperator(staff) })
    }
    await recordPayment(orderId, {
      method: 'cash',
      // The rules check the amount against the order, so it has to be the cart's real total.
      amount: CART_TOTAL,
      cashTendered: CART_TOTAL,
      user: asUser(staff),
      staff: asOperator(staff),
    })
    const before = await getDoc(doc(db, 'orderPayments', orderId))

    await correctFulfillment(orderId, {
      from: 'ready',
      to: 'preparing',
      user: asUser(staff),
      staff: asOperator(staff),
    })

    // Two independent axes: moving one never writes the other's document.
    const after = await getDoc(doc(db, 'orderPayments', orderId))
    expect(after.data()).toEqual(before.data())
  })

  /**
   * The counter works the queue during service, so recovering from a mis-tap made moments
   * earlier is theirs — and, since an admin has no fulfilment write at all, theirs alone.
   * Reopening a DELIVERED order is nobody's: handing over stops the customer's clock and
   * makes the sale final, so correcting one is a void rather than a rewind.
   */
  it('2, 4. lets a staff account take the two backward steps the kitchen owns', async () => {
    const orderId = await placeOrder()
    for (const [from, to] of [
      [FULFILLMENT_ORIGIN, 'preparing'],
      ['preparing', 'ready'],
    ] as const) {
      await setFulfillment(orderId, { from, to, user: asUser(staff), staff: asOperator(staff) })
    }

    await correctFulfillment(orderId, {
      from: 'ready',
      to: 'preparing',
      user: asUser(staff),
      staff: asOperator(staff),
    })
    let record = await getDoc(doc(db, 'orderFulfillment', orderId))
    expect(record.get('status')).toBe('preparing')
    // Being worked on again, so it no longer claims a finish time.
    expect(record.get('readyAt')).toBeNull()

    await correctFulfillment(orderId, {
      from: 'preparing',
      to: FULFILLMENT_ORIGIN,
      user: asUser(staff),
      staff: asOperator(staff),
    })
    record = await getDoc(doc(db, 'orderFulfillment', orderId))
    expect(record.get('status')).toBe('pending')
    expect(record.get('readyAt')).toBeNull()
    expect(record.get('deliveredAt')).toBeNull()
  })

  it('6. refuses a staff account reopening a delivered order', async () => {
    const orderId = await placeOrder()
    for (const [from, to] of [
      [FULFILLMENT_ORIGIN, 'preparing'],
      ['preparing', 'ready'],
      ['ready', 'delivered'],
    ] as const) {
      await setFulfillment(orderId, { from, to, user: asUser(staff), staff: asOperator(staff) })
    }

    await expect(
      correctFulfillment(orderId, {
        from: 'delivered',
        to: 'ready',
        user: asUser(staff),
        staff: asOperator(staff),
      }),
    ).rejects.toThrow()

    // And it really is still delivered — the refusal changed nothing.
    const record = await getDoc(doc(db, 'orderFulfillment', orderId))
    expect(record.get('status')).toBe('delivered')
  })

  // ---- Order timing ---------------------------------------------------------
  // The app's own write path, against the real rules. The clock starts at the ORDER's
  // createdAt and stops at the HANDOVER, so what is checked here is `deliveredAt` — and
  // that a fulfilment step never touches the order document the start lives on.

  async function finishOf(orderId: string) {
    const snapshot = await getDoc(doc(db, 'orderFulfillment', orderId))
    return snapshot.exists() ? (snapshot.get('readyAt') ?? null) : null
  }

  /** The handover — the one stamp the elapsed duration is measured to. */
  async function handoverOf(orderId: string) {
    const snapshot = await getDoc(doc(db, 'orderFulfillment', orderId))
    return snapshot.exists() ? (snapshot.get('deliveredAt') ?? null) : null
  }

  async function createdAtOf(orderId: string) {
    return (await getDoc(doc(db, 'orders', orderId))).get('createdAt')
  }

  async function advance(orderId: string, from: FulfillmentStatus, to: FulfillmentStatus) {
    await setFulfillment(orderId, {
      from,
      to,
      user: asUser(staff),
      staff: asOperator(staff),
    })
  }

  it('gives a brand-new order a start the moment it is rung up', async () => {
    const orderId = await placeOrder()

    // No fulfilment document, no payment, nothing started — and the clock already has a
    // start, because the order itself is the start.
    expect(await createdAtOf(orderId)).not.toBeNull()
    expect((await getDoc(doc(db, 'orderFulfillment', orderId))).exists()).toBe(false)
  })

  it('records no finish when preparation begins', async () => {
    const orderId = await placeOrder()
    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')

    expect(await finishOf(orderId)).toBeNull()
  })

  it('stamps the finish at ready, and leaves the order untouched', async () => {
    const orderId = await placeOrder()
    const created = await createdAtOf(orderId)

    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')
    await advance(orderId, 'preparing', 'ready')

    const readyAt = await finishOf(orderId)
    expect(readyAt).not.toBeNull()
    expect(readyAt.toMillis()).toBeGreaterThanOrEqual(created.toMillis())
    // Orders are immutable: the start cannot have moved, whatever the kitchen did.
    expect((await createdAtOf(orderId)).isEqual(created)).toBe(true)
  })

  it('keeps the finished duration available after delivery', async () => {
    const orderId = await placeOrder()
    const created = await createdAtOf(orderId)
    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')
    await advance(orderId, 'preparing', 'ready')
    const atReady = await finishOf(orderId)

    await advance(orderId, 'ready', 'delivered')

    // Both ends of the window are exactly as they were, so the duration is too.
    expect((await finishOf(orderId)).isEqual(atReady)).toBe(true)
    expect((await createdAtOf(orderId)).isEqual(created)).toBe(true)
  })

  it('11. clears the finish when staff correct ready back to preparing', async () => {
    const orderId = await placeOrder()
    const created = await createdAtOf(orderId)
    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')
    await advance(orderId, 'preparing', 'ready')

    await correctFulfillment(orderId, {
      from: 'ready',
      to: 'preparing',
      user: asUser(staff),
      staff: asOperator(staff),
    })

    // Not finished any more, so the timer runs again — from the original start, which the
    // correction had no way of touching.
    expect(await finishOf(orderId)).toBeNull()
    expect((await createdAtOf(orderId)).isEqual(created)).toBe(true)

    // The abandoned attempt is not lost: the journal still records every step.
    const journal = await getDocs(collection(db, 'orderFulfillment', orderId, 'transitions'))
    expect(journal.size).toBe(3)
  })

  it('11. clears it when staff correct preparing back to pending', async () => {
    const orderId = await placeOrder()
    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')

    await correctFulfillment(orderId, {
      from: 'preparing',
      to: FULFILLMENT_ORIGIN,
      user: asUser(staff),
      staff: asOperator(staff),
    })

    expect(await finishOf(orderId)).toBeNull()
  })

  it('does not stamp a handover on any step short of delivery', async () => {
    const orderId = await placeOrder()
    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')
    expect(await handoverOf(orderId)).toBeNull()

    await advance(orderId, 'preparing', 'ready')
    // Ready is not the end of the wait: the customer still does not have the order.
    expect(await handoverOf(orderId)).toBeNull()
    expect(await finishOf(orderId)).not.toBeNull()
  })

  it('stamps the handover on delivery, and measures the wait from the order', async () => {
    const orderId = await placeOrder()
    const created = await createdAtOf(orderId)
    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')
    await advance(orderId, 'preparing', 'ready')
    await advance(orderId, 'ready', 'delivered')

    const deliveredAt = await handoverOf(orderId)
    expect(deliveredAt).not.toBeNull()
    expect(deliveredAt.toMillis()).toBeGreaterThanOrEqual(created.toMillis())
    // Orders are immutable: the start cannot have moved.
    expect((await createdAtOf(orderId)).isEqual(created)).toBe(true)
  })

  it('11. keeps the handover, because no role can clear it', async () => {
    const orderId = await placeOrder()
    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')
    await advance(orderId, 'preparing', 'ready')
    await advance(orderId, 'ready', 'delivered')
    const readyBefore = await finishOf(orderId)
    const handoverBefore = await handoverOf(orderId)

    await signInAs(admin)
    await expect(
      correctFulfillment(orderId, {
        from: 'delivered',
        to: 'ready',
        user: asUser(admin),
        staff: asOperator(admin),
      }),
    ).rejects.toThrow()

    // The one write that used to resume the customer's clock is gone, so a delivered order's
    // duration is now final in the strongest sense: nothing can reopen the window.
    expect((await handoverOf(orderId)).isEqual(handoverBefore)).toBe(true)
    expect((await finishOf(orderId)).isEqual(readyBefore)).toBe(true)
  })

  it('is unaffected by payment, taken at any point in the workflow', async () => {
    const orderId = await placeOrder()
    const created = await createdAtOf(orderId)

    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')
    await recordPayment(orderId, {
      method: 'cash',
      amount: CART_TOTAL,
      cashTendered: CART_TOTAL,
      user: asUser(staff),
      staff: asOperator(staff),
    })
    await advance(orderId, 'preparing', 'ready')
    await advance(orderId, 'ready', 'delivered')

    // Neither end of the window moved, and the payment lives in its own document.
    expect((await createdAtOf(orderId)).isEqual(created)).toBe(true)
    expect(await handoverOf(orderId)).not.toBeNull()
    expect((await getDoc(doc(db, 'orderPayments', orderId))).exists()).toBe(true)
  })

  it('lets a second step be taken before the first is acknowledged', async () => {
    // What an optimistic UI does: two writes queued back to back. The second must not send
    // back a finish it read from the local cache before the server resolved it.
    const orderId = await placeOrder()
    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')

    const finishing = setFulfillment(orderId, {
      from: 'preparing',
      to: 'ready',
      user: asUser(staff),
      staff: asOperator(staff),
    })
    const delivering = setFulfillment(orderId, {
      from: 'ready',
      to: 'delivered',
      user: asUser(staff),
      staff: asOperator(staff),
    })
    await Promise.all([finishing, delivering])

    const record = await getDoc(doc(db, 'orderFulfillment', orderId))
    expect(record.get('status')).toBe('delivered')
    // The finish recorded by the first write survived the second, which said nothing about
    // it, and the second recorded the handover.
    expect(record.get('readyAt')).not.toBeNull()
    expect(record.get('deliveredAt')).not.toBeNull()
  })
})

describe('voidOrder cancels a sale without editing it', () => {
  async function placeOrder(): Promise<string> {
    await signInAs(staff)
    const created = await createOrder({
      cart: CART,
      placement: DINE_IN,
      user: asUser(staff),
      staff: asOperator(staff),
    })
    return created.id
  }

  it('writes the void, leaving the order exactly as it was', async () => {
    const orderId = await placeOrder()
    await signInAs(admin)
    await voidOrder(orderId, {
      amount: CART_TOTAL,
      reason: 'Wrong item rung up',
      authorizedBy: asUser(admin),
      initiatedBy: asInitiator(admin),
    })

    const record = await getDoc(doc(db, 'orderVoids', orderId))
    expect(record.get('amount')).toBe(CART_TOTAL)
    expect(record.get('reason')).toBe('Wrong item rung up')
    expect(record.get('voidedByName')).toBe('Ada Admin')
    expect(record.get('initiatedByStaffName')).toBe('Ada Admin')

    const order = await getDoc(doc(db, 'orders', orderId))
    expect(order.get('total')).toBe(CART_TOTAL)
    expect(Object.keys(order.data() ?? {})).not.toContain('voided')
  })

  it('refuses a void from a staff account', async () => {
    const orderId = await placeOrder()
    await expect(
      voidOrder(orderId, {
        amount: CART_TOTAL,
        reason: 'Nope',
        authorizedBy: asUser(staff),
        initiatedBy: asInitiator(staff),
      }),
    ).rejects.toThrow()
  })

  it('refuses an empty reason before it reaches the database', async () => {
    const orderId = await placeOrder()
    await signInAs(admin)
    await expect(
      voidOrder(orderId, {
        amount: CART_TOTAL,
        reason: '   ',
        authorizedBy: asUser(admin),
        initiatedBy: asInitiator(admin),
      }),
    ).rejects.toThrow()
  })

  it('refuses payment on a voided sale', async () => {
    const orderId = await placeOrder()
    await signInAs(admin)
    await voidOrder(orderId, {
      amount: CART_TOTAL,
      reason: 'Cancelled',
      authorizedBy: asUser(admin),
      initiatedBy: asInitiator(admin),
    })

    await signInAs(staff)
    await expect(
      recordPayment(orderId, {
        method: 'cash',
        amount: CART_TOTAL,
        cashTendered: 5000,
        user: asUser(staff),
        staff: asOperator(staff),
      }),
    ).rejects.toThrow()
  })
})

/**
 * Phase 11. The point of this block is that it is driven exactly as the till drives it: the
 * staff session stays signed in throughout, and the only thing that changes is whether a
 * manager's credentials are presented. Nothing here grants the staff account anything.
 */
describe('a staff-initiated void needs a manager to authorise it', () => {
  async function placeOrderAsStaff(): Promise<string> {
    await signInAs(staff)
    const created = await createOrder({
      cart: CART,
      placement: DINE_IN,
      user: asUser(staff),
      staff: asOperator(staff),
    })
    return created.id
  }

  /** What the dialog does once a manager has typed their credentials. */
  function voidWithManagerAuthorization(orderId: string, credentials: ManagerCredentials) {
    return withManagerAuthorization(credentials, (manager, firestore) =>
      voidOrder(
        orderId,
        {
          amount: CART_TOTAL,
          reason: 'Wrong item rung up',
          authorizedBy: manager,
          initiatedBy: asInitiator(staff),
        },
        firestore,
      ),
    )
  }

  it('records the manager as authoriser and the till operator as initiator', async () => {
    const orderId = await placeOrderAsStaff()

    await voidWithManagerAuthorization(orderId, {
      email: admin.email,
      password: ACCOUNT_PASSWORD,
    })

    const record = await getDoc(doc(db, 'orderVoids', orderId))
    expect(record.get('voidedBy')).toBe(admin.uid)
    expect(record.get('voidedByName')).toBe('Ada Admin')
    expect(record.get('initiatedByStaffId')).toBe(staff.uid)
    expect(record.get('initiatedByStaffName')).toBe('Sam Staff')

    // The sale itself is still untouched — a void is a counter-entry, not an edit.
    const order = await getDoc(doc(db, 'orders', orderId))
    expect(order.get('total')).toBe(CART_TOTAL)
  })

  it('leaves the till signed in as the staff member throughout', async () => {
    const orderId = await placeOrderAsStaff()
    await voidWithManagerAuthorization(orderId, {
      email: admin.email,
      password: ACCOUNT_PASSWORD,
    })

    // The borrowed authority is gone, and the session that is left is the till's own — not
    // the manager's. A staff account that came out of this holding admin rights would be the
    // whole feature backfiring.
    expect(auth.currentUser?.uid).toBe(staff.uid)
    const stillStaff = await getDoc(doc(db, 'users', staff.uid))
    expect(stillStaff.get('role')).toBe('staff')
  })

  it('writes nothing when the manager password is wrong', async () => {
    const orderId = await placeOrderAsStaff()

    await expect(
      voidWithManagerAuthorization(orderId, { email: admin.email, password: 'not-the-password' }),
    ).rejects.toThrow()

    expect((await getDoc(doc(db, 'orderVoids', orderId))).exists()).toBe(false)
    expect((await getDoc(doc(db, 'orders', orderId))).get('total')).toBe(CART_TOTAL)
    expect(auth.currentUser?.uid).toBe(staff.uid)
  })

  it('refuses a staff member’s own credentials as the authorisation', async () => {
    const orderId = await placeOrderAsStaff()

    // Correct credentials, real account, simply not a manager's. This is the attempt the
    // feature exists to refuse, and it fails before the write is even attempted.
    await expect(
      voidWithManagerAuthorization(orderId, { email: staff.email, password: ACCOUNT_PASSWORD }),
    ).rejects.toThrow(NOT_A_MANAGER_MESSAGE.key)

    expect((await getDoc(doc(db, 'orderVoids', orderId))).exists()).toBe(false)
  })

  it('refuses a deactivated manager', async () => {
    const orderId = await placeOrderAsStaff()
    await seed(async (context) => {
      await setDoc(doc(context.firestore(), 'users', admin.uid), { active: false }, { merge: true })
    })

    await expect(
      voidWithManagerAuthorization(orderId, { email: admin.email, password: ACCOUNT_PASSWORD }),
    ).rejects.toThrow(NOT_A_MANAGER_MESSAGE.key)

    expect((await getDoc(doc(db, 'orderVoids', orderId))).exists()).toBe(false)
  })

  it('refuses an initiator the roster has never heard of', async () => {
    const orderId = await placeOrderAsStaff()

    // The manager is genuine, so this is refused by the RULES rather than by the sign-in:
    // an initiator has to be a real, active identity, not a name someone typed.
    await expect(
      withManagerAuthorization({ email: admin.email, password: ACCOUNT_PASSWORD }, (manager, fs) =>
        voidOrder(
          orderId,
          {
            amount: CART_TOTAL,
            reason: 'Wrong item rung up',
            authorizedBy: manager,
            initiatedBy: { staffId: 'ghost', staffName: 'Nobody' },
          },
          fs,
        ),
      ),
    ).rejects.toThrow()

    expect((await getDoc(doc(db, 'orderVoids', orderId))).exists()).toBe(false)
  })
})

describe('the menu write API keeps cost and its journal in step', () => {
  const ITEM = {
    name: 'Cortado',
    // No translations: the everyday case, and what every item written before this feature
    // existed looks like.
    names: {},
    description: 'Equal parts espresso and milk',
    categoryId: 'cat-coffee',
    price: 990,
    sortOrder: 2,
    active: true,
    modifierGroupIds: [],
  }

  it('creates an item and its cost in one batch', async () => {
    await signInAs(admin)
    const itemId = await createMenuItem(ITEM, 380)

    const item = await getDoc(doc(db, 'menuItems', itemId))
    expect(item.get('price')).toBe(990)
    const cost = await getDoc(doc(db, 'menuItemCosts', itemId))
    expect(cost.get('cost')).toBe(380)
    // Cost is never a field on the item: that split is what makes "staff cannot see cost"
    // true, and the rules now refuse an item that carries one.
    expect(Object.keys(item.data() ?? {})).not.toContain('cost')
  })

  it('writes the translations an admin gave, and nothing more', async () => {
    await signInAs(admin)
    const itemId = await createMenuItem(
      { ...ITEM, names: { ms: 'Kopi Susu', zh: '牛奶咖啡' } },
      380,
    )

    const item = await getDoc(doc(db, 'menuItems', itemId))
    expect(item.get('name')).toBe('Cortado')
    expect(item.get('names')).toEqual({ ms: 'Kopi Susu', zh: '牛奶咖啡' })
    // English is the item's `name` and is never repeated inside the map: one fact, one place.
    expect(Object.keys(item.get('names') as object)).not.toContain('en')
  })

  it('leaves an item with no translations looking exactly as it always did', async () => {
    await signInAs(admin)
    const itemId = await createMenuItem(ITEM, 380)

    const item = await getDoc(doc(db, 'menuItems', itemId))
    expect(item.get('name')).toBe('Cortado')
    expect(item.get('names')).toEqual({})
  })

  it('adds a translation to an item that had none, keeping its English name', async () => {
    await signInAs(admin)
    const itemId = await createMenuItem(ITEM, 380)

    await updateMenuItem(
      itemId,
      { ...ITEM, names: { ms: 'Kopi Susu' } },
      { next: 380, previous: 380 },
    )

    const item = await getDoc(doc(db, 'menuItems', itemId))
    expect(item.get('name')).toBe('Cortado')
    expect(item.get('names')).toEqual({ ms: 'Kopi Susu' })
  })

  it('keeps one translation when the other is edited, and clears one that is emptied', async () => {
    await signInAs(admin)
    const itemId = await createMenuItem(
      { ...ITEM, names: { ms: 'Kopi Susu', zh: '牛奶咖啡' } },
      380,
    )

    // Editing Malay only — the form sends both fields back, so Chinese survives.
    await updateMenuItem(
      itemId,
      { ...ITEM, names: { ms: 'Kopi Susu Panas', zh: '牛奶咖啡' } },
      { next: 380, previous: 380 },
    )
    expect((await getDoc(doc(db, 'menuItems', itemId))).get('names')).toEqual({
      ms: 'Kopi Susu Panas',
      zh: '牛奶咖啡',
    })

    // Clearing Malay deliberately removes it from the document rather than leaving a blank.
    await updateMenuItem(
      itemId,
      { ...ITEM, names: { zh: '牛奶咖啡' } },
      { next: 380, previous: 380 },
    )
    expect((await getDoc(doc(db, 'menuItems', itemId))).get('names')).toEqual({ zh: '牛奶咖啡' })
  })

  it('reads an item written before translations existed', async () => {
    // Written the way the collection was written for months: a name and no map at all. It
    // must still parse, and must answer every language with its English name.
    await signInAs(admin)
    const itemId = await createMenuItem(ITEM, 380)
    const stored = await getDoc(doc(db, 'menuItems', itemId))
    const { names: _dropped, ...legacyShape } = stored.data() ?? {}

    const parsed = parseMenuItem(itemId, legacyShape)
    expect(parsed?.name).toBe('Cortado')
    expect(getLocalizedMenuItemName(parsed!, 'ms')).toBe('Cortado')
    expect(getLocalizedMenuItemName(parsed!, 'zh')).toBe('Cortado')
  })

  it('journals a cost change alongside the value it replaced', async () => {
    await signInAs(admin)
    const itemId = await createMenuItem(ITEM, 380)
    await updateMenuItem(itemId, { ...ITEM, price: 1050 }, { next: 420, previous: 380 })

    const history = await getDocs(collection(db, 'menuItemCostHistory'))
    const costs = history.docs.map((entry) => entry.get('cost'))
    expect(costs).toContain(380)
    expect(costs).toContain(420)
    // Every entry points at a real item — which the rules now require, so a typo in the id
    // would fail the write rather than quietly poison a later margin figure.
    expect(history.docs.every((entry) => entry.get('itemId') === itemId)).toBe(true)

    const cost = await getDoc(doc(db, 'menuItemCosts', itemId))
    expect(cost.get('cost')).toBe(420)
  })

  /**
   * Cost is mandatory, so clearing one is no longer something this API can express.
   *
   * It used to: `next: null` deleted the document and journalled the clearing. That is gone
   * because an item without a cost quietly turns every margin it appears in into an upper
   * bound, and the form now refuses to save one. The type refuses `null` at compile time;
   * this is the runtime half of the same guarantee, for a caller that reached here anyway.
   */
  it('refuses to write a missing or nonsensical cost, leaving the existing one alone', async () => {
    await signInAs(admin)
    const itemId = await createMenuItem(ITEM, 380)

    for (const bad of [null, undefined, -1, 4.5, Number.NaN, '380']) {
      await expect(
        updateMenuItem(itemId, ITEM, { next: bad as unknown as number, previous: 380 }),
      ).rejects.toThrow()
    }

    const cost = await getDoc(doc(db, 'menuItemCosts', itemId))
    expect(cost.get('cost')).toBe(380)
  })

  it('accepts a cost of zero, which is a statement rather than an absence', async () => {
    await signInAs(admin)
    const itemId = await createMenuItem(ITEM, 0)

    const cost = await getDoc(doc(db, 'menuItemCosts', itemId))
    expect(cost.exists()).toBe(true)
    expect(cost.get('cost')).toBe(0)
  })

  it('deletes an item together with its cost', async () => {
    await signInAs(admin)
    const itemId = await createMenuItem(ITEM, 380)
    await deleteMenuItem(itemId)

    expect((await getDoc(doc(db, 'menuItems', itemId))).exists()).toBe(false)
    // The rules now refuse the item's deletion unless its cost goes too, so this passing
    // proves deleteMenuItem still batches both.
    expect((await getDoc(doc(db, 'menuItemCosts', itemId))).exists()).toBe(false)
  })

  it('refuses a staff account any of it', async () => {
    await signInAs(staff)
    await expect(createMenuItem(ITEM, 380)).rejects.toThrow()
  })
})

describe('the staff roster deactivates rather than deletes', () => {
  it('creates, renames and retires a member', async () => {
    await signInAs(admin)
    const id = await createStaffMember('Alice')
    expect((await getDoc(doc(db, 'staffMembers', id))).get('active')).toBe(true)

    await renameStaffMember(id, 'Alicia')
    expect((await getDoc(doc(db, 'staffMembers', id))).get('name')).toBe('Alicia')

    await setStaffActive(id, false)
    const retired = await getDoc(doc(db, 'staffMembers', id))
    // Still there, which is the point: past orders name this person.
    expect(retired.exists()).toBe(true)
    expect(retired.get('active')).toBe(false)
  })

  it('refuses a sale attributed to a retired member', async () => {
    await signInAs(admin)
    const id = await createStaffMember('Alice')
    await setStaffActive(id, false)

    await signInAs(staff)
    await expect(
      createOrder({
        cart: CART,
        placement: DINE_IN,
        user: asUser(staff),
        staff: { id, name: 'Alice' },
      }),
    ).rejects.toThrow()
  })

  it('refuses a sale pinned on a colleague by sending their name', async () => {
    await signInAs(admin)
    const id = await createStaffMember('Alice')

    await signInAs(staff)
    await expect(
      createOrder({
        cart: CART,
        placement: DINE_IN,
        user: asUser(staff),
        // The id is real and active; the name is not the one the roster holds.
        staff: { id, name: 'Someone Else' },
      }),
    ).rejects.toThrow()
  })
})

describe('menu item customisation, through the app’s own writes', () => {
  const CHICKEN = 'item-chicken-chop-rice'

  const VEG = {
    shared: true,
    name: 'Vegetables',
    selection: 'single' as const,
    required: true,
    sortOrder: 0,
    active: true,
    options: [
      { id: 'veg-normal', name: 'Normal', names: {}, priceAdjustment: 0, cost: 0, active: true },
      {
        id: 'veg-none',
        name: 'No vegetables',
        names: {},
        priceAdjustment: 0,
        cost: 0,
        active: true,
      },
    ],
  }

  const ADDONS = {
    shared: true,
    name: 'Add-ons',
    selection: 'multiple' as const,
    required: false,
    sortOrder: 1,
    active: true,
    options: [
      {
        id: 'add-chicken',
        name: 'Extra chicken',
        names: {},
        priceAdjustment: 300,
        cost: 0,
        active: true,
      },
    ],
  }

  beforeEach(async () => {
    await seed(async (context) => {
      await setDoc(doc(context.firestore(), 'menuItems', CHICKEN), {
        name: 'Chicken Chop Rice',
        categoryId: 'cat-mains',
        price: 800,
        sortOrder: 1,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })
  })

  /** A line as the till would build it, through the real cart. */
  function configured(modifiers: Parameters<typeof lineKeyOf>[0]['modifiers']) {
    return addToCart(EMPTY_CART, {
      menuItemId: CHICKEN,
      name: 'Chicken Chop Rice',
      basePrice: 800,
      modifiers,
    })
  }

  const NO_VEG = {
    groupId: 'g-veg',
    groupName: 'Vegetables',
    optionId: 'veg-none',
    optionName: 'No vegetables',
    priceAdjustment: 0,
  }
  const EXTRA_CHICKEN = {
    groupId: 'g-addons',
    groupName: 'Add-ons',
    optionId: 'add-chicken',
    optionName: 'Extra chicken',
    priceAdjustment: 300,
  }

  it('lets an admin create and update a group, and refuses a staff account both', async () => {
    await signInAs(admin)
    const groupId = await createModifierGroupForItem(CHICKEN, VEG)
    expect((await getDoc(doc(db, 'modifierGroups', groupId))).get('name')).toBe('Vegetables')

    await updateModifierGroup(groupId, { ...VEG, name: 'Veg' })
    expect((await getDoc(doc(db, 'modifierGroups', groupId))).get('name')).toBe('Veg')

    await signInAs(staff)
    await expect(createModifierGroupForItem(CHICKEN, ADDONS)).rejects.toThrow()
    await expect(updateModifierGroup(groupId, { ...VEG, name: 'Hacked' })).rejects.toThrow()
    // ...and the till can still read what it needs to take an order.
    expect((await getDoc(doc(db, 'modifierGroups', groupId))).get('name')).toBe('Veg')
  })

  it('writes the chosen options onto the order line, with the price they produced', async () => {
    await signInAs(staff)
    const created = await createOrder({
      cart: configured([NO_VEG, EXTRA_CHICKEN]),
      placement: TAKEAWAY,
      user: asUser(staff),
      staff: asOperator(staff),
    })

    const stored = await getDoc(doc(db, 'orders', created.id))
    const lines = stored.get('lines') as Record<string, unknown>[]
    expect(lines).toHaveLength(1)
    expect(lines[0]?.basePrice).toBe(800)
    expect(lines[0]?.unitPrice).toBe(1100)
    expect(lines[0]?.modifiers).toHaveLength(2)
    expect(stored.get('total')).toBe(1100)
  })

  it('keeps two configurations of the same item as two lines, and merges identical ones', async () => {
    await signInAs(staff)
    let cart = configured([NO_VEG])
    cart = addToCart(cart, {
      menuItemId: CHICKEN,
      name: 'Chicken Chop Rice',
      basePrice: 800,
      modifiers: [NO_VEG],
    })
    cart = addToCart(cart, {
      menuItemId: CHICKEN,
      name: 'Chicken Chop Rice',
      basePrice: 800,
      modifiers: [EXTRA_CHICKEN],
    })

    const created = await createOrder({
      cart,
      placement: TAKEAWAY,
      user: asUser(staff),
      staff: asOperator(staff),
    })

    const lines = (await getDoc(doc(db, 'orders', created.id))).get('lines') as Record<
      string,
      unknown
    >[]
    // Two lines, not three and not one: 2 × plain-with-no-veg, 1 × with extra chicken.
    expect(lines).toHaveLength(2)
    expect(lines.map((line) => line.quantity)).toEqual([2, 1])
    expect(lines.map((line) => line.unitPrice)).toEqual([800, 1100])
  })

  it('leaves a placed order alone when the admin edits the configuration afterwards', async () => {
    await signInAs(admin)
    const groupId = await createModifierGroupForItem(CHICKEN, ADDONS)

    await signInAs(staff)
    const created = await createOrder({
      cart: configured([{ ...EXTRA_CHICKEN, groupId }]),
      placement: TAKEAWAY,
      user: asUser(staff),
      staff: asOperator(staff),
    })
    const before = (await getDoc(doc(db, 'orders', created.id))).get('lines')

    // The admin renames the option, triples its price, deactivates it, then deletes the
    // whole group — every way the configuration can move out from under a past sale.
    await signInAs(admin)
    await updateModifierGroup(groupId, {
      ...ADDONS,
      options: [
        {
          id: 'add-chicken',
          name: 'Extra beef',
          names: {},
          priceAdjustment: 900,
          cost: 0,
          active: false,
        },
      ],
    })
    await deleteModifierGroup(groupId)
    expect((await getDoc(doc(db, 'modifierGroups', groupId))).exists()).toBe(false)

    const after = (await getDoc(doc(db, 'orders', created.id))).get('lines') as Record<
      string,
      unknown
    >[]
    // Byte for byte what was sold: the receipt still reads "Extra chicken +RM3.00".
    expect(after).toEqual(before)
    const modifiers = after[0]?.modifiers as Record<string, unknown>[]
    expect(modifiers[0]?.optionName).toBe('Extra chicken')
    expect(modifiers[0]?.priceAdjustment).toBe(300)
    expect(after[0]?.unitPrice).toBe(1100)
  })

  /**
   * Translating a modifier option, all the way through: what is written, what is read back,
   * and what an order that was rung up in between keeps saying afterwards.
   *
   * The unit tests pin the rule and the component tests pin the two screens. This is the only
   * place that proves the document the write API actually produces is the document the parse
   * actually reads — the seam where a field name could drift and every other suite stay green.
   */
  it('stores an option’s translations, reads them back, and never touches a past order', async () => {
    await signInAs(admin)
    const groupId = await createModifierGroupForItem(CHICKEN, {
      ...ADDONS,
      options: [
        {
          id: 'add-egg',
          name: 'Fried Egg',
          names: { ms: 'Telur Goreng', zh: '煎蛋' },
          priceAdjustment: 100,
          cost: 40,
          active: true,
        },
      ],
    })

    // What landed: English in `name`, the translations in `names`, and English NOT in there.
    const stored = await getDoc(doc(db, 'modifierGroups', groupId))
    const option = (stored.get('options') as Record<string, unknown>[])[0]!
    expect(option.name).toBe('Fried Egg')
    expect(option.names).toEqual({ ms: 'Telur Goreng', zh: '煎蛋' })
    expect(Object.keys(option.names as object)).not.toContain('en')

    // What the app reads back out of it.
    const group = parseModifierGroup(groupId, stored.data()!)!
    expect(getLocalizedModifierOptionName(group.options[0]!, 'ms')).toBe('Telur Goreng')
    expect(getLocalizedModifierOptionName(group.options[0]!, 'zh')).toBe('煎蛋')
    expect(getLocalizedModifierOptionName(group.options[0]!, 'en')).toBe('Fried Egg')

    // A till speaking Malay rings one up. The name is snapshotted, exactly as the item's is.
    await signInAs(staff)
    const chosen = selectionOf(group, group.options[0]!, 'ms')
    expect(chosen.optionName).toBe('Telur Goreng')
    const created = await createOrder({
      cart: configured([chosen]),
      placement: TAKEAWAY,
      user: asUser(staff),
      staff: asOperator(staff),
    })

    // The admin retranslates the option afterwards, and reprices nothing.
    await signInAs(admin)
    await updateModifierGroup(groupId, {
      ...ADDONS,
      options: [
        {
          id: 'add-egg',
          name: 'Fried Egg',
          names: { ms: 'Telur Mata', zh: '煎蛋' },
          priceAdjustment: 100,
          cost: 40,
          active: true,
        },
      ],
    })

    const retranslated = parseModifierGroup(
      groupId,
      (await getDoc(doc(db, 'modifierGroups', groupId))).data()!,
    )!
    expect(getLocalizedModifierOptionName(retranslated.options[0]!, 'ms')).toBe('Telur Mata')

    // And the order still says what the customer was told, because it never dereferences it.
    const lines = (await getDoc(doc(db, 'orders', created.id))).get('lines') as Record<
      string,
      unknown
    >[]
    const modifiers = lines[0]?.modifiers as Record<string, unknown>[]
    expect(modifiers[0]?.optionName).toBe('Telur Goreng')
    expect(modifiers[0]?.optionId).toBe('add-egg')
    expect(modifiers[0]?.priceAdjustment).toBe(100)

    // Costing is identified by the ids, so translating moved none of it.
    const cost = await getDoc(doc(db, 'modifierOptionCosts', modifierCostKey(groupId, 'add-egg')))
    expect(cost.get('cost')).toBe(40)
  })

  it('leaves an option written before translations existed exactly as it was', async () => {
    // The document shape this collection has always had, written straight past the API.
    await seed(async (context) => {
      await setDoc(doc(context.firestore(), 'modifierGroups', 'legacy-group'), {
        name: 'Add-ons',
        selection: 'multiple',
        required: false,
        sortOrder: 1,
        active: true,
        options: [{ id: 'add-egg', name: 'Fried Egg', priceAdjustment: 100, active: true }],
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })

    await signInAs(staff)
    const stored = await getDoc(doc(db, 'modifierGroups', 'legacy-group'))
    // Nothing migrated it: there is still no `names` field in the document at all.
    expect((stored.get('options') as Record<string, unknown>[])[0]).not.toHaveProperty('names')

    // And it is still nameable on every till, in every language.
    const group = parseModifierGroup('legacy-group', stored.data()!)!
    for (const language of ['en', 'ms', 'zh'] as const) {
      expect(getLocalizedModifierOptionName(group.options[0]!, language)).toBe('Fried Egg')
    }
  })

  /**
   * The cascade deliberately narrowed when groups became reusable.
   *
   * A shared definition outlives any one item: "Sugar Level" is attached to several drinks,
   * so deleting one of them must not take it away from the rest. A LEGACY group is the
   * opposite — it names exactly one item in `itemId` and can be offered by no other, so
   * deleting that item leaves it unreachable and it still goes. Both halves are asserted
   * because getting either wrong is silent.
   */
  it('records a shared group with no owner, and lists it on the item', async () => {
    await signInAs(admin)
    const id = await createModifierGroupForItem(CHICKEN, VEG)

    const group = await getDoc(doc(db, 'modifierGroups', id))
    // No owner: that is what makes it attachable to other items.
    expect(group.data()?.itemId).toBeUndefined()
    expect((await getDoc(doc(db, 'menuItems', CHICKEN))).data()?.modifierGroupIds).toEqual([id])
  })

  it('records an item-specific group against its owner, and does NOT list it', async () => {
    await signInAs(admin)
    const id = await createModifierGroupForItem(CHICKEN, { ...VEG, shared: false })

    const group = await getDoc(doc(db, 'modifierGroups', id))
    // The owner is the association. Listing it as well would record the same fact twice.
    expect(group.data()?.itemId).toBe(CHICKEN)
    expect((await getDoc(doc(db, 'menuItems', CHICKEN))).data()?.modifierGroupIds ?? []).toEqual([])
  })

  it('creates an item and its item-specific group in one batch', async () => {
    await signInAs(admin)
    // The owner does not exist when the rules see the group — they ask `existsAfter`, so the
    // whole batch is judged on the state it leaves behind.
    const itemId = await createMenuItem(
      {
        name: 'Nasi Lemak',
        names: {},
        description: '',
        categoryId: 'cat-mains',
        price: 700,
        sortOrder: 3,
        active: true,
        modifierGroupIds: [],
      },
      300,
      [{ ...VEG, shared: false }],
    )

    const all = await getDocs(collection(db, 'modifierGroups'))
    const owned = all.docs.filter((entry) => entry.data().itemId === itemId)
    expect(owned).toHaveLength(1)
    expect((await getDoc(doc(db, 'menuItems', itemId))).data()?.modifierGroupIds).toEqual([])
  })

  it('takes an item-specific group with the item, and never a shared one', async () => {
    await signInAs(admin)
    const owned = await createModifierGroupForItem(CHICKEN, { ...VEG, shared: false })
    const shared = await createModifierGroupForItem(CHICKEN, ADDONS)

    await deleteMenuItem(CHICKEN)

    expect((await getDoc(doc(db, 'modifierGroups', owned))).exists()).toBe(false)
    expect((await getDoc(doc(db, 'modifierGroups', shared))).exists()).toBe(true)
  })

  it('leaves a shared group alone when an item using it is deleted', async () => {
    await signInAs(admin)
    const shared = await createModifierGroupForItem(CHICKEN, VEG)

    await deleteMenuItem(CHICKEN)

    expect((await getDoc(doc(db, 'modifierGroups', shared))).exists()).toBe(true)
    expect((await getDoc(doc(db, 'menuItems', CHICKEN))).exists()).toBe(false)
  })

  it('still takes a legacy item-owned group with it when the item is deleted', async () => {
    // Written the way the first version of this feature wrote them: an owner, and no entry
    // on the item. Nothing in the app writes this shape any more, which is why it is seeded.
    await seed(async (context) => {
      await setDoc(doc(context.firestore(), 'modifierGroups', 'legacy-veg'), {
        itemId: CHICKEN,
        name: 'Vegetables',
        selection: 'single',
        required: true,
        sortOrder: 0,
        active: true,
        options: [
          {
            id: 'veg-normal',
            name: 'Normal',
            names: {},
            priceAdjustment: 0,
            cost: 0,
            active: true,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })

    await signInAs(admin)
    await deleteMenuItem(CHICKEN)

    expect((await getDoc(doc(db, 'modifierGroups', 'legacy-veg'))).exists()).toBe(false)
  })

  it('detaches a shared group from every item when the group itself is deleted', async () => {
    await signInAs(admin)
    const shared = await createModifierGroupForItem(CHICKEN, VEG)
    expect((await getDoc(doc(db, 'menuItems', CHICKEN))).data()?.modifierGroupIds).toEqual([shared])

    await deleteModifierGroup(shared)

    expect((await getDoc(doc(db, 'modifierGroups', shared))).exists()).toBe(false)
    // The item survives, and no longer claims a group that is gone.
    expect((await getDoc(doc(db, 'menuItems', CHICKEN))).data()?.modifierGroupIds).toEqual([])
  })

  it('does not disturb payment or fulfilment on an order that carries modifiers', async () => {
    await signInAs(staff)
    const created = await createOrder({
      cart: configured([EXTRA_CHICKEN]),
      placement: TAKEAWAY,
      user: asUser(staff),
      staff: asOperator(staff),
    })

    await recordPayment(created.id, {
      method: 'cash',
      amount: 1100,
      cashTendered: 2000,
      user: asUser(staff),
      staff: asOperator(staff),
    })
    await setFulfillment(created.id, {
      from: 'pending',
      to: 'preparing',
      user: asUser(staff),
      staff: asOperator(staff),
    })

    const payment = await getDoc(doc(db, 'orderPayments', created.id))
    expect(payment.get('amount')).toBe(1100)
    expect(payment.get('changeGiven')).toBe(900)
    expect((await getDoc(doc(db, 'orderFulfillment', created.id))).get('status')).toBe('preparing')
  })
})

/**
 * Modifier option costs, written by the API that actually writes them.
 *
 * The rules suite proves the database accepts the shape and refuses staff; the unit suite
 * proves the arithmetic. What only this suite can prove is that `updateModifierGroup` puts
 * the group and its costs in ONE batch, under the field names the rules and the report both
 * expect — a mismatch there would leave both of the other suites green.
 */
describe('modifier option costs, through the app’s own writes', () => {
  const RICE = 'item-braised-pork-rice'

  const ADDON = (over: Partial<ModifierGroupInput> = {}): ModifierGroupInput => ({
    shared: true,
    name: 'Add-on',
    selection: 'multiple',
    required: false,
    sortOrder: 0,
    active: true,
    options: [
      { id: 'opt-egg', name: 'Egg', names: {}, priceAdjustment: 150, cost: 40, active: true },
      {
        id: 'opt-duck',
        name: 'Smoked Duck',
        names: {},
        priceAdjustment: 400,
        cost: 200,
        active: true,
      },
    ],
    ...over,
  })

  beforeEach(async () => {
    await seed(async (context) => {
      await setDoc(doc(context.firestore(), 'menuItems', RICE), {
        name: 'Braised Pork Rice',
        categoryId: 'cat-mains',
        price: 900,
        sortOrder: 1,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })
    await signInAs(admin)
  })

  const costOf = async (groupId: string, optionId: string) =>
    getDoc(doc(db, 'modifierOptionCosts', modifierCostKey(groupId, optionId)))

  const journalFor = async (groupId: string) => {
    const all = await getDocs(collection(db, 'modifierOptionCostHistory'))
    return all.docs.map((entry) => entry.data()).filter((entry) => entry.groupId === groupId)
  }

  it('writes a cost document per option when the group is created', async () => {
    const groupId = await createModifierGroupForItem(RICE, ADDON())

    const egg = await costOf(groupId, 'opt-egg')
    expect(egg.exists()).toBe(true)
    expect(egg.get('cost')).toBe(40)
    expect(egg.get('groupId')).toBe(groupId)
    expect(egg.get('optionId')).toBe('opt-egg')

    expect((await costOf(groupId, 'opt-duck')).get('cost')).toBe(200)
  })

  it('keeps the cost OUT of the group document, which staff can read', async () => {
    const groupId = await createModifierGroupForItem(RICE, ADDON())

    const group = await getDoc(doc(db, 'modifierGroups', groupId))
    const options = group.get('options') as Record<string, unknown>[]
    // The selling price is there, as it must be — the till needs it. The cost is not.
    expect(options[0]?.priceAdjustment).toBe(150)
    for (const option of options) expect(option).not.toHaveProperty('cost')
  })

  it('journals the opening figure for every option a new group introduces', async () => {
    const groupId = await createModifierGroupForItem(RICE, ADDON())

    const journal = await journalFor(groupId)
    expect(journal).toHaveLength(2)
    expect(journal.map((entry) => entry.optionId).sort()).toEqual(['opt-duck', 'opt-egg'])
    for (const entry of journal) expect(entry.recordedBy).toBe(admin.uid)
  })

  it('appends an entry when a cost changes, and leaves the unchanged one alone', async () => {
    const groupId = await createModifierGroupForItem(RICE, ADDON())

    const group = ADDON()
    await updateModifierGroup(groupId, {
      ...group,
      options: [{ ...group.options[0]!, cost: 90 }, group.options[1]!],
    })

    expect((await costOf(groupId, 'opt-egg')).get('cost')).toBe(90)
    expect((await costOf(groupId, 'opt-duck')).get('cost')).toBe(200)

    // Two openings plus one change. The duck did not move, so it journalled nothing:
    // a journal records events, not saves.
    const journal = await journalFor(groupId)
    expect(journal).toHaveLength(3)
    expect(journal.filter((entry) => entry.optionId === 'opt-egg')).toHaveLength(2)
    expect(journal.filter((entry) => entry.optionId === 'opt-duck')).toHaveLength(1)
  })

  it('does not regenerate option ids when only the cost changes', async () => {
    const groupId = await createModifierGroupForItem(RICE, ADDON())
    const group = ADDON()
    await updateModifierGroup(groupId, {
      ...group,
      options: [{ ...group.options[0]!, cost: 90 }, group.options[1]!],
    })

    // The ids are snapshotted onto every order line that chose them, so a changed cost must
    // not mint new ones — the cost would then attach to an option no past sale mentions.
    const saved = await getDoc(doc(db, 'modifierGroups', groupId))
    const ids = (saved.get('options') as Record<string, unknown>[]).map((o) => o.id)
    expect(ids).toEqual(['opt-egg', 'opt-duck'])
    expect((await costOf(groupId, 'opt-egg')).exists()).toBe(true)
  })

  it('backfills an opening entry for an option costed before the journal existed', async () => {
    // The state Phase 3 left behind, reproduced exactly: a group whose option has a current
    // cost, recorded at a known moment, and no history at all. Seeded with rules disabled
    // because the API cannot produce it any more — every write it makes now journals.
    const groupId = await createModifierGroupForItem(RICE, {
      ...ADDON(),
      options: [
        { id: 'opt-egg', name: 'Egg', names: {}, priceAdjustment: 150, cost: 40, active: true },
      ],
    })
    const recordedAt = (await costOf(groupId, 'opt-egg')).get('updatedAt')
    await seed(async (context) => {
      const raw = context.firestore()
      const entries = await getDocs(collection(raw, 'modifierOptionCostHistory'))
      await Promise.all(entries.docs.map((entry) => deleteDoc(entry.ref)))
    })
    expect(await journalFor(groupId)).toHaveLength(0)

    await updateModifierGroup(groupId, {
      ...ADDON(),
      options: [
        { id: 'opt-egg', name: 'Egg', names: {}, priceAdjustment: 150, cost: 90, active: true },
      ],
    })

    const journal = await journalFor(groupId)
    expect(journal).toHaveLength(2)
    const opening = journal.find((entry) => entry.cost === 40)
    expect(opening).toBeDefined()
    // Dated when the OLD figure was recorded, and never the moment of the edit — otherwise
    // every sale made before this edit would flip from costed to uncosted, which is the whole
    // point of the backfill.
    expect(opening?.effectiveFrom.isEqual(recordedAt)).toBe(true)
  })

  it('leaves a removed option’s cost in place, so old sales stay costed', async () => {
    const groupId = await createModifierGroupForItem(RICE, ADDON())
    const group = ADDON()

    await updateModifierGroup(groupId, { ...group, options: [group.options[0]!] })

    // The duck is gone from the menu. Orders that already chose it still resolve its cost
    // through this document, so deleting it would leave those sales suddenly uncosted.
    expect((await costOf(groupId, 'opt-duck')).get('cost')).toBe(200)
  })

  it('refuses a STAFF account writing an option cost, through the same API', async () => {
    const groupId = await createModifierGroupForItem(RICE, ADDON())

    await signInAs(staff)
    await expect(
      updateModifierGroup(groupId, {
        ...ADDON(),
        options: [
          { id: 'opt-egg', name: 'Egg', names: {}, priceAdjustment: 150, cost: 0, active: true },
        ],
      }),
    ).rejects.toThrow()

    // Nothing moved: the whole batch was refused, group and costs together.
    await signInAs(admin)
    expect((await costOf(groupId, 'opt-egg')).get('cost')).toBe(40)
  })
})
