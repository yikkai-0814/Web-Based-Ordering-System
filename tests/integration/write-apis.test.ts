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
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createMenuItem, deleteMenuItem, updateMenuItem } from '@/features/menu/menu-api'
import type { Cart } from '@/features/pos/cart'
import { lineKeyOf } from '@/features/menu/modifiers'
import {
  createModifierGroup,
  deleteModifierGroup,
  updateModifierGroup,
} from '@/features/menu/menu-api'
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
    ).rejects.toThrow(/less than the total/i)
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

  it('lets an admin step one place back, and journals the correction', async () => {
    const orderId = await placeOrder()
    await setFulfillment(orderId, {
      from: FULFILLMENT_ORIGIN,
      to: 'preparing',
      user: asUser(staff),
      staff: asOperator(staff),
    })

    await signInAs(admin)
    await correctFulfillment(orderId, {
      from: 'preparing',
      to: FULFILLMENT_ORIGIN,
      user: asUser(admin),
      staff: asOperator(admin),
    })

    const record = await getDoc(doc(db, 'orderFulfillment', orderId))
    expect(record.get('status')).toBe('pending')
    // Rewound in status, but not in the trail: the correction is a step like any other.
    const journal = await getDocs(collection(db, 'orderFulfillment', orderId, 'transitions'))
    expect(journal.size).toBe(2)
  })

  it('refuses a staff account stepping an order backwards', async () => {
    const orderId = await placeOrder()
    await setFulfillment(orderId, {
      from: FULFILLMENT_ORIGIN,
      to: 'preparing',
      user: asUser(staff),
      staff: asOperator(staff),
    })

    await expect(
      correctFulfillment(orderId, {
        from: 'preparing',
        to: FULFILLMENT_ORIGIN,
        user: asUser(staff),
        staff: asOperator(staff),
      }),
    ).rejects.toThrow()
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

  it('clears the finish when an admin corrects ready back to preparing', async () => {
    const orderId = await placeOrder()
    const created = await createdAtOf(orderId)
    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')
    await advance(orderId, 'preparing', 'ready')

    await signInAs(admin)
    await correctFulfillment(orderId, {
      from: 'ready',
      to: 'preparing',
      user: asUser(admin),
      staff: asOperator(admin),
    })

    // Not finished any more, so the timer runs again — from the original start, which the
    // correction had no way of touching.
    expect(await finishOf(orderId)).toBeNull()
    expect((await createdAtOf(orderId)).isEqual(created)).toBe(true)

    // The abandoned attempt is not lost: the journal still records every step.
    const journal = await getDocs(collection(db, 'orderFulfillment', orderId, 'transitions'))
    expect(journal.size).toBe(3)
  })

  it('clears it when an admin corrects preparing back to pending', async () => {
    const orderId = await placeOrder()
    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')

    await signInAs(admin)
    await correctFulfillment(orderId, {
      from: 'preparing',
      to: FULFILLMENT_ORIGIN,
      user: asUser(admin),
      staff: asOperator(admin),
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

  it('clears the handover when an admin corrects delivered back to ready', async () => {
    const orderId = await placeOrder()
    await advance(orderId, FULFILLMENT_ORIGIN, 'preparing')
    await advance(orderId, 'preparing', 'ready')
    await advance(orderId, 'ready', 'delivered')
    const readyBefore = await finishOf(orderId)

    await signInAs(admin)
    await correctFulfillment(orderId, {
      from: 'delivered',
      to: 'ready',
      user: asUser(admin),
      staff: asOperator(admin),
    })

    // The clock runs again; the kitchen's own finish is untouched by the correction.
    expect(await handoverOf(orderId)).toBeNull()
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
    ).rejects.toThrow(NOT_A_MANAGER_MESSAGE)

    expect((await getDoc(doc(db, 'orderVoids', orderId))).exists()).toBe(false)
  })

  it('refuses a deactivated manager', async () => {
    const orderId = await placeOrderAsStaff()
    await seed(async (context) => {
      await setDoc(doc(context.firestore(), 'users', admin.uid), { active: false }, { merge: true })
    })

    await expect(
      voidWithManagerAuthorization(orderId, { email: admin.email, password: ACCOUNT_PASSWORD }),
    ).rejects.toThrow(NOT_A_MANAGER_MESSAGE)

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
    description: 'Equal parts espresso and milk',
    categoryId: 'cat-coffee',
    price: 990,
    sortOrder: 2,
    active: true,
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

  it('clearing a cost removes the document and journals the clearing as null', async () => {
    await signInAs(admin)
    const itemId = await createMenuItem(ITEM, 380)
    await updateMenuItem(itemId, ITEM, { next: null, previous: 380 })

    const cost = await getDoc(doc(db, 'menuItemCosts', itemId))
    expect(cost.exists()).toBe(false)
    const history = await getDocs(collection(db, 'menuItemCostHistory'))
    // A clearing is a real event, not an absence — reporting must not fall back past it.
    expect(history.docs.some((entry) => entry.get('cost') === null)).toBe(true)
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
    itemId: CHICKEN,
    name: 'Vegetables',
    selection: 'single' as const,
    required: true,
    sortOrder: 0,
    active: true,
    options: [
      { id: 'veg-normal', name: 'Normal', priceAdjustment: 0, active: true },
      { id: 'veg-none', name: 'No vegetables', priceAdjustment: 0, active: true },
    ],
  }

  const ADDONS = {
    itemId: CHICKEN,
    name: 'Add-ons',
    selection: 'multiple' as const,
    required: false,
    sortOrder: 1,
    active: true,
    options: [{ id: 'add-chicken', name: 'Extra chicken', priceAdjustment: 300, active: true }],
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
    const groupId = await createModifierGroup(VEG)
    expect((await getDoc(doc(db, 'modifierGroups', groupId))).get('name')).toBe('Vegetables')

    await updateModifierGroup(groupId, { ...VEG, name: 'Veg' })
    expect((await getDoc(doc(db, 'modifierGroups', groupId))).get('name')).toBe('Veg')

    await signInAs(staff)
    await expect(createModifierGroup(ADDONS)).rejects.toThrow()
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
    const groupId = await createModifierGroup(ADDONS)

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
      options: [{ id: 'add-chicken', name: 'Extra beef', priceAdjustment: 900, active: false }],
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

  it('takes an item’s groups with it when the item is deleted', async () => {
    await signInAs(admin)
    const groupId = await createModifierGroup(VEG)
    const otherItemGroup = await createModifierGroup({ ...ADDONS, itemId: 'item-flat-white' })

    await deleteMenuItem(CHICKEN)

    expect((await getDoc(doc(db, 'modifierGroups', groupId))).exists()).toBe(false)
    // Another item's configuration is untouched.
    expect((await getDoc(doc(db, 'modifierGroups', otherItemGroup))).exists()).toBe(true)
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
