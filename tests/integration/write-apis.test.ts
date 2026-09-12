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
import {
  correctFulfillment,
  FULFILLMENT_ORIGIN,
  setFulfillment,
} from '@/features/pos/fulfillment-api'
import { recordPayment } from '@/features/pos/payment-api'
import { createOrder } from '@/features/pos/pos-api'
import { businessDateOf } from '@/features/pos/types'
import { voidOrder } from '@/features/pos/void-api'
import { createStaffMember, renameStaffMember, setStaffActive } from '@/features/staff/staff-api'
import { db } from '@/lib/firebase'

import {
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
  { menuItemId: 'item-flat-white', name: 'Flat White', unitPrice: 1250, quantity: 2 },
  { menuItemId: 'item-croissant', name: 'Croissant', unitPrice: 690, quantity: 1 },
]
const CART_TOTAL = 3190

const DINE_IN = { orderType: 'dine_in' as const, tableNumber: '5' }
const TAKEAWAY = { orderType: 'takeaway' as const, tableNumber: '' }

const asUser = (account: TestAccount) => ({
  uid: account.uid,
  displayName: account.displayName,
})

/** The self-operator form: the signed-in account standing in as the till operator. */
const asOperator = (account: TestAccount) => ({ id: account.uid, name: account.displayName })

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
      await setFulfillment(orderId, { from, to, user: asUser(staff), staff: asOperator(staff) })
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
      user: asUser(admin),
    })

    const record = await getDoc(doc(db, 'orderVoids', orderId))
    expect(record.get('amount')).toBe(CART_TOTAL)
    expect(record.get('reason')).toBe('Wrong item rung up')
    expect(record.get('voidedByName')).toBe('Ada Admin')

    const order = await getDoc(doc(db, 'orders', orderId))
    expect(order.get('total')).toBe(CART_TOTAL)
    expect(Object.keys(order.data() ?? {})).not.toContain('voided')
  })

  it('refuses a void from a staff account', async () => {
    const orderId = await placeOrder()
    await expect(
      voidOrder(orderId, { amount: CART_TOTAL, reason: 'Nope', user: asUser(staff) }),
    ).rejects.toThrow()
  })

  it('refuses an empty reason before it reaches the database', async () => {
    const orderId = await placeOrder()
    await signInAs(admin)
    await expect(
      voidOrder(orderId, { amount: CART_TOTAL, reason: '   ', user: asUser(admin) }),
    ).rejects.toThrow()
  })

  it('refuses payment on a voided sale', async () => {
    const orderId = await placeOrder()
    await signInAs(admin)
    await voidOrder(orderId, { amount: CART_TOTAL, reason: 'Cancelled', user: asUser(admin) })

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
