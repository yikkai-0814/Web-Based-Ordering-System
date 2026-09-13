import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { changeDue } from '@/features/pos/cart'
import {
  isCompleted,
  overallStatusOf,
  resolveFulfillmentState,
  type FulfillmentStatus,
} from '@/features/pos/fulfillment'
import { canRecordPayment, resolvePaymentState } from '@/features/pos/payments'
import {
  parseOrder,
  parseOrderFulfillment,
  parseOrderPayment,
  paymentOperatorNameOf,
} from '@/features/pos/types'
import { buildReport, indexCostHistory, type ReportOrder } from '@/features/reports/aggregate'

/**
 * The pay-later workflow, walked end to end against the emulator.
 *
 * Every other rules file asks whether one write is allowed. This one follows an order
 * through its whole life — placed, prepared, collected, paid — and checks at each step that
 * the **rules** and the **pure functions the UI renders from** agree about what state it is
 * in. A rule that permits a write the app then displays wrongly would pass both of the
 * other suites and fail here.
 *
 * Money figures follow the worked example in the requirement: a RM 15.50 order, RM 20.00
 * handed over, RM 4.50 back.
 */

const ADMIN_UID = 'admin-uid'
const STAFF_UID = 'staff-uid'
const DATE = '2026-09-11'

const TOTAL = 1550
const CASH_GIVEN = 2000
const CHANGE = 450

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ordering-system-payment-workflow-test',
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

afterEach(async () => {
  await testEnv.clearFirestore()
})

const staffDb = () => testEnv.authenticatedContext(STAFF_UID).firestore()
const adminDb = () => testEnv.authenticatedContext(ADMIN_UID).firestore()

/**
 * One shared Firebase login for the whole shift, exactly as the stall runs it. Alice and Bob
 * are operator identities selected after login — they have no accounts of their own, and
 * this test would be meaningless if they did.
 */
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()

    await setDoc(doc(db, 'users', ADMIN_UID), {
      uid: ADMIN_UID,
      email: 'admin@example.com',
      displayName: 'Ada Admin',
      role: 'admin',
      active: true,
      createdAt: new Date(),
    })
    await setDoc(doc(db, 'users', STAFF_UID), {
      uid: STAFF_UID,
      email: 'staff@example.com',
      displayName: 'Shared Till',
      role: 'staff',
      active: true,
      createdAt: new Date(),
    })

    for (const { id, name } of [
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob' },
    ]) {
      await setDoc(doc(db, 'staffMembers', id), {
        name,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }

    await setDoc(doc(db, 'menuItems', 'i1'), {
      name: 'Flat White',
      categoryId: 'c1',
      price: TOTAL,
      sortOrder: 1,
      active: true,
    })
  })
}

/** Exactly the document `createOrder` writes: no payment fields anywhere. */
const orderDoc = (over: Record<string, unknown> = {}) => ({
  number: 1,
  businessDate: DATE,
  lines: [
    {
      menuItemId: 'i1',
      name: 'Flat White',
      basePrice: TOTAL,
      unitPrice: TOTAL,
      modifiers: [],
      quantity: 1,
    },
  ],
  // Phase 7: every order records how it is served. Dine-in carries a table number;
  // a takeaway must not carry the key at all.
  orderType: 'dine_in',
  tableNumber: '5',
  total: TOTAL,
  createdAt: new Date(),
  createdBy: STAFF_UID,
  createdByName: 'Shared Till',
  staffId: 'alice',
  staffName: 'Alice',
  ...over,
})

/**
 * Exactly the document `recordPayment` writes: both the shared account and the operator who
 * took the money.
 */
const paymentDoc = (orderId: string, over: Record<string, unknown> = {}) => ({
  orderId,
  method: 'cash',
  amount: TOTAL,
  cashTendered: CASH_GIVEN,
  changeGiven: CHANGE,
  paidAt: new Date(),
  paidBy: STAFF_UID,
  paidByName: 'Shared Till',
  paidByStaffId: 'alice',
  paidByStaffName: 'Alice',
  ...over,
})

/** Reads an order back through the app's own parser and payment resolver. */
async function stateOf(orderId: string) {
  const db = staffDb()
  const orderSnap = await getDoc(doc(db, 'orders', orderId))
  const paymentSnap = await getDoc(doc(db, 'orderPayments', orderId))

  const order = parseOrder(orderId, orderSnap.data() ?? {})
  expect(order).not.toBeNull()

  const payment = paymentSnap.exists() ? parseOrderPayment(orderId, paymentSnap.data() ?? {}) : null

  const fulfillmentSnap = await getDoc(doc(db, 'orderFulfillment', orderId))
  const record = fulfillmentSnap.exists()
    ? parseOrderFulfillment(orderId, fulfillmentSnap.data() ?? {})
    : null

  const voided = (await getDoc(doc(db, 'orderVoids', orderId))).exists()
  const state = resolvePaymentState(order!, payment)
  const fulfillment = resolveFulfillmentState(order!, record)

  return {
    order: order!,
    payment,
    state,
    fulfillment,
    overall: overallStatusOf({ fulfillment, payment: state, voided }),
  }
}

/**
 * Exactly the current-state document `setFulfillment` writes: both the shared account and
 * the named operator who made the move.
 */
const stepDoc = (
  orderId: string,
  status: FulfillmentStatus,
  operator: { id: string; name: string } = { id: 'alice', name: 'Alice' },
) => ({
  orderId,
  status,
  updatedAt: new Date(),
  updatedBy: STAFF_UID,
  updatedByName: 'Shared Till',
  updatedByStaffId: operator.id,
  updatedByStaffName: operator.name,
})

/** The journal entry written alongside it, in the same batch. */
const stepTrail = (
  orderId: string,
  from: FulfillmentStatus,
  to: FulfillmentStatus,
  operator: { id: string; name: string } = { id: 'alice', name: 'Alice' },
) => ({
  orderId,
  from,
  to,
  at: new Date(),
  updatedBy: STAFF_UID,
  updatedByName: 'Shared Till',
  updatedByStaffId: operator.id,
  updatedByStaffName: operator.name,
})

/**
 * The finish timestamp the rules will accept for a step into `to`. The clock's START is the
 * order's own createdAt, which no fulfilment write can touch.
 *
 * Kept alongside this file's other write helpers rather than imported from the app: these
 * suites exist to state what the SERVER accepts, and sharing the app's table would make the
 * two agree by construction. `serverTimestamp()` is the only value accepted where the rules
 * compare against `request.time`.
 */
function preparationFor(from: string, to: string, prior: { readyAt: unknown }) {
  // The handover stops the clock and has no "unchanged" case: an order is delivered or not.
  const deliveredAt = to === 'delivered' ? serverTimestamp() : null
  if (to === 'ready' && from === 'preparing') {
    return { readyAt: serverTimestamp(), deliveredAt }
  }
  if (to === 'ready' || to === 'delivered') return { readyAt: prior.readyAt, deliveredAt }
  return { readyAt: null, deliveredAt }
}

/**
 * `stepDoc()` built against what the document currently holds, since a preserved timestamp
 * must be resent exactly — the parent is written whole.
 */
async function stepDocAt(
  db: ReturnType<typeof staffDb>,
  orderId: string,
  to: FulfillmentStatus,
  operator: { id: string; name: string } = { id: 'alice', name: 'Alice' },
) {
  const existing = await getDoc(doc(db, 'orderFulfillment', orderId))
  const from = existing.exists() ? (existing.get('status') as string) : 'pending'
  const prior = existing.exists() ? { readyAt: existing.get('readyAt') ?? null } : { readyAt: null }

  return { ...stepDoc(orderId, to, operator), ...preparationFor(from, to, prior) }
}

/** One move, written the way fulfillment-api.ts writes it: both documents, one batch. */
async function moveOrder(
  db: ReturnType<typeof staffDb>,
  orderId: string,
  from: FulfillmentStatus,
  to: FulfillmentStatus,
  operator: { id: string; name: string } = { id: 'alice', name: 'Alice' },
) {
  const batch = writeBatch(db)
  batch.set(doc(db, 'orderFulfillment', orderId), await stepDocAt(db, orderId, to, operator))
  batch.set(
    doc(collection(db, 'orderFulfillment', orderId, 'transitions')),
    stepTrail(orderId, from, to, operator),
  )
  return batch.commit()
}

describe('Test 1 — an order is created unpaid', () => {
  it('is placed with no payment method and no cash figures', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o1'), orderDoc()))

    const { order, state } = await stateOf('o1')

    expect(state.status).toBe('unpaid')
    expect(order.paymentMethod).toBeNull()
    expect(order.cashTendered).toBeNull()
    expect(order.changeGiven).toBeNull()
    // And the app would offer the Record Payment button.
    expect(canRecordPayment({ state, voided: false })).toEqual({ ok: true })
  })

  it('keeps the operator that placed it', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o1'), orderDoc()))

    const { order } = await stateOf('o1')
    expect(order.createdBy).toBe(STAFF_UID)
    expect(order.createdByName).toBe('Shared Till')
    expect(order.staffId).toBe('alice')
    expect(order.staffName).toBe('Alice')
  })
})

describe('Test 2 — cash payment after the order is completed', () => {
  it('records the payment, the cash given and the change, and turns the order Paid', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o1'), orderDoc()))

    // The same arithmetic the dialog does before it writes anything.
    expect(changeDue(TOTAL, CASH_GIVEN)).toEqual({ ok: true, change: CHANGE })

    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', 'o1'), paymentDoc('o1')))

    const { state } = await stateOf('o1')
    expect(state).toEqual({
      status: 'paid',
      method: 'cash',
      cashTendered: CASH_GIVEN,
      changeGiven: CHANGE,
      source: 'recorded',
    })
  })

  it('leaves the order document itself completely unchanged', async () => {
    await seed()
    const original = orderDoc()
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o1'), original))
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', 'o1'), paymentDoc('o1')))

    const { order } = await stateOf('o1')
    expect(order.total).toBe(original.total)
    expect(order.number).toBe(original.number)
    expect(order.lines).toEqual(original.lines)
    // Immutability is not merely unused here — it is still enforced.
    await assertFails(setDoc(doc(staffDb(), 'orders', 'o1'), { ...original, total: 1 }))
  })
})

describe('Test 3 — insufficient cash', () => {
  it('is refused, and the order stays unpaid', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o1'), orderDoc()))

    // Refused by the dialog...
    const attempt = changeDue(TOTAL, 1000)
    expect(attempt.ok).toBe(false)

    // ...and independently by the rules, for a client that skipped the dialog. Both the
    // honest under-payment and the doctored one that fakes the change figure.
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderPayments', 'o1'),
        paymentDoc('o1', { cashTendered: 1000, changeGiven: -550 }),
      ),
    )
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderPayments', 'o1'),
        paymentDoc('o1', { cashTendered: 1000, changeGiven: 0 }),
      ),
    )

    const { state } = await stateOf('o1')
    expect(state.status).toBe('unpaid')
  })
})

describe('Test 4 — e-wallet payment', () => {
  it('turns the order Paid with method ewallet and no cash figures', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o2'), orderDoc({ number: 2 })))
    await assertSucceeds(
      setDoc(
        doc(staffDb(), 'orderPayments', 'o2'),
        paymentDoc('o2', { method: 'ewallet', cashTendered: null, changeGiven: null }),
      ),
    )

    const { state } = await stateOf('o2')
    expect(state).toEqual({
      status: 'paid',
      method: 'ewallet',
      cashTendered: null,
      changeGiven: null,
      source: 'recorded',
    })
  })
})

describe('Test 5 — an order cannot be paid twice', () => {
  it('is refused by the rules, and the app would not offer the button either', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o1'), orderDoc()))
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', 'o1'), paymentDoc('o1')))

    const { state } = await stateOf('o1')
    expect(canRecordPayment({ state, voided: false }).ok).toBe(false)

    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', 'o1'), paymentDoc('o1', { method: 'ewallet' })),
    )
    await assertFails(
      setDoc(doc(adminDb(), 'orderPayments', 'o1'), paymentDoc('o1', { paidBy: ADMIN_UID })),
    )

    // The first payment is untouched by the failed attempts.
    const after = await stateOf('o1')
    expect(after.state).toMatchObject({ method: 'cash', cashTendered: CASH_GIVEN })
  })
})

describe('Test 6 — a voided order cannot be paid', () => {
  it('refuses payment once the sale has been voided', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o1'), orderDoc()))
    await assertSucceeds(
      setDoc(doc(adminDb(), 'orderVoids', 'o1'), {
        orderId: 'o1',
        reason: 'Customer left',
        amount: TOTAL,
        voidedAt: new Date(),
        voidedBy: ADMIN_UID,
        voidedByName: 'Ada Admin',
        initiatedByStaffId: ADMIN_UID,
        initiatedByStaffName: 'Ada Admin',
      }),
    )

    await assertFails(setDoc(doc(staffDb(), 'orderPayments', 'o1'), paymentDoc('o1')))

    const { state } = await stateOf('o1')
    expect(canRecordPayment({ state, voided: true }).ok).toBe(false)
  })

  it('still lets an admin void an order that was already paid, with no refund invented', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o1'), orderDoc()))
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', 'o1'), paymentDoc('o1')))

    await assertSucceeds(
      setDoc(doc(adminDb(), 'orderVoids', 'o1'), {
        orderId: 'o1',
        reason: 'Returned after payment',
        amount: TOTAL,
        voidedAt: new Date(),
        voidedBy: ADMIN_UID,
        voidedByName: 'Ada Admin',
        initiatedByStaffId: ADMIN_UID,
        initiatedByStaffName: 'Ada Admin',
      }),
    )

    // The payment record survives the void — it is what happened, and the void is the
    // counter-entry. Nothing here reverses money automatically.
    const { state } = await stateOf('o1')
    expect(state.status).toBe('paid')
  })
})

describe('Test 7 — staff attribution survives payment', () => {
  const operators = [
    { staffId: STAFF_UID, staffName: 'Shared Till' },
    { staffId: 'alice', staffName: 'Alice' },
    { staffId: 'bob', staffName: 'Bob' },
  ]

  it('records an order for each operator and pays it without disturbing attribution', async () => {
    await seed()

    for (const [index, operator] of operators.entries()) {
      const id = `o${index + 1}`
      await assertSucceeds(
        setDoc(doc(staffDb(), 'orders', id), orderDoc({ number: index + 1, ...operator })),
      )
      // Paid by the SAME operator who placed it, which is the ordinary case at a counter.
      await assertSucceeds(
        setDoc(
          doc(staffDb(), 'orderPayments', id),
          paymentDoc(id, {
            paidByStaffId: operator.staffId,
            paidByStaffName: operator.staffName,
          }),
        ),
      )

      const { order, payment, state } = await stateOf(id)
      expect(state.status).toBe('paid')
      // The four order attribution fields are exactly as they were placed.
      expect(order.createdBy).toBe(STAFF_UID)
      expect(order.createdByName).toBe('Shared Till')
      expect(order.staffId).toBe(operator.staffId)
      expect(order.staffName).toBe(operator.staffName)
      // And the payment carries the matching pair of its own.
      expect(payment?.paidBy).toBe(STAFF_UID)
      expect(payment?.paidByName).toBe('Shared Till')
      expect(payment?.paidByStaffId).toBe(operator.staffId)
      expect(payment?.paidByStaffName).toBe(operator.staffName)
      expect(paymentOperatorNameOf(payment!)).toBe(operator.staffName)
    }
  })

  it('lets one operator take payment for an order another placed, naming each correctly', async () => {
    await seed()
    // Alice rings it up, Bob is on the till when the customer comes back to pay. Both facts
    // are recorded, and neither overwrites the other.
    await assertSucceeds(
      setDoc(doc(staffDb(), 'orders', 'o1'), orderDoc({ staffId: 'alice', staffName: 'Alice' })),
    )
    await assertSucceeds(
      setDoc(
        doc(staffDb(), 'orderPayments', 'o1'),
        paymentDoc('o1', { paidByStaffId: 'bob', paidByStaffName: 'Bob' }),
      ),
    )

    const { order, payment } = await stateOf('o1')
    expect(order.staffName).toBe('Alice')
    expect(payment?.paidByStaffName).toBe('Bob')
  })

  it('refuses payment naming an operator who is not really that person', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o1'), orderDoc()))

    // Alice's id under Bob's name, and an identity that does not exist at all.
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderPayments', 'o1'),
        paymentDoc('o1', { paidByStaffId: 'alice', paidByStaffName: 'Bob' }),
      ),
    )
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderPayments', 'o1'),
        paymentDoc('o1', { paidByStaffId: 'ghost', paidByStaffName: 'Ghost' }),
      ),
    )

    const { state } = await stateOf('o1')
    expect(state.status).toBe('unpaid')
  })

  it('still refuses an order attributed to a name that is not the operator’s', async () => {
    await seed()
    // Paying orders gained nobody the ability to pin a sale on a colleague.
    await assertFails(
      setDoc(doc(staffDb(), 'orders', 'bad'), orderDoc({ staffId: 'alice', staffName: 'Bob' })),
    )
  })
})

describe('Test 8 — orders that already carried payment', () => {
  /** Seeded with the rules off, which is how the real ones came to exist. */
  async function seedLegacy() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'orders', 'legacy'),
        orderDoc({
          number: 9,
          paymentMethod: 'cash',
          cashTendered: CASH_GIVEN,
          changeGiven: CHANGE,
        }),
      )
    })
  }

  it('still parses and still reads as paid, with its figures intact', async () => {
    await seed()
    await seedLegacy()

    const { order, state } = await stateOf('legacy')

    expect(order.total).toBe(TOTAL)
    expect(state).toEqual({
      status: 'paid',
      method: 'cash',
      cashTendered: CASH_GIVEN,
      changeGiven: CHANGE,
      source: 'legacy',
    })
  })

  it('cannot be paid a second time through the new flow', async () => {
    await seed()
    await seedLegacy()

    const { state } = await stateOf('legacy')
    expect(canRecordPayment({ state, voided: false }).ok).toBe(false)
    await assertFails(setDoc(doc(staffDb(), 'orderPayments', 'legacy'), paymentDoc('legacy')))
  })

  it('was not corrupted — no migration touched it', async () => {
    await seed()
    await seedLegacy()

    const snapshot = await getDoc(doc(staffDb(), 'orders', 'legacy'))
    const data = snapshot.data() ?? {}
    expect(data.paymentMethod).toBe('cash')
    expect(data.cashTendered).toBe(CASH_GIVEN)
    expect(data.changeGiven).toBe(CHANGE)
  })
})

describe('Test 9 — reports distinguish paid from unpaid', () => {
  it('reads payments as admin and reports collected against outstanding', async () => {
    await seed()

    // Two orders placed; only one is paid.
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o1'), orderDoc()))
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o2'), orderDoc({ number: 2 })))
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', 'o1'), paymentDoc('o1')))

    // The reporting page reads payments with the admin's own permissions.
    await assertSucceeds(getDoc(doc(adminDb(), 'orderPayments', 'o1')))

    const rows: ReportOrder[] = []
    for (const id of ['o1', 'o2']) {
      const { order, state } = await stateOf(id)
      rows.push({
        id: order.id,
        number: order.number,
        businessDate: order.businessDate,
        createdAt: order.createdAt ? order.createdAt.toDate() : null,
        lines: order.lines,
        total: order.total,
        paid: state.status === 'paid',
        paymentMethod: state.status === 'paid' ? state.method : null,
      })
    }

    const report = buildReport({
      orders: rows,
      voids: new Map(),
      history: indexCostHistory([]),
      currentCosts: new Map(),
    })

    // Revenue is unchanged in meaning: both orders were sold.
    expect(report.revenue).toBe(TOTAL * 2)
    expect(report.orderCount).toBe(2)
    // What has been collected is reported separately, and is not assumed from existence.
    expect(report.paidOrderCount).toBe(1)
    expect(report.unpaidOrderCount).toBe(1)
    expect(report.collectedRevenue).toBe(TOTAL)
    expect(report.outstandingRevenue).toBe(TOTAL)
    // Only the paid order appears under a payment method.
    expect(report.payments).toEqual([{ method: 'cash', count: 1, amount: TOTAL }])
  })

  it('does not let a staff account read cost, history or the reports’ inputs', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orders', 'o1'), orderDoc()))
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', 'o1'), paymentDoc('o1')))

    // Recording payment is the one new power staff gained. It is not a foot in the door.
    await assertFails(getDoc(doc(staffDb(), 'menuItemCosts', 'i1')))
  })
})

describe('Test 8 - the whole pay-later journey, against the live rules', () => {
  it('runs pending to delivered, stays outstanding, then completes on payment', async () => {
    await seed()
    const db = staffDb()

    // Placed. No fulfilment document exists yet - absence IS pending.
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), orderDoc()))
    let now = await stateOf('o1')
    expect(now.fulfillment).toBe('pending')
    expect(now.state.status).toBe('unpaid')
    expect(now.overall).toBe('pending')

    // The food is made. Each step is a separate, individually validated write.
    await assertSucceeds(
      setDoc(doc(db, 'orderFulfillment', 'o1'), await stepDocAt(db, 'o1', 'preparing')),
    )
    now = await stateOf('o1')
    expect(now.overall).toBe('preparing')

    await assertSucceeds(
      updateDoc(doc(db, 'orderFulfillment', 'o1'), await stepDocAt(db, 'o1', 'ready')),
    )
    now = await stateOf('o1')
    expect(now.overall).toBe('ready')

    await assertSucceeds(
      updateDoc(doc(db, 'orderFulfillment', 'o1'), await stepDocAt(db, 'o1', 'delivered')),
    )

    // Handed over, and the customer has not paid. The state this feature exists for: it must
    // not read as finished, and the money must still show as owed.
    now = await stateOf('o1')
    expect(now.fulfillment).toBe('delivered')
    expect(now.state.status).toBe('unpaid')
    expect(now.overall).toBe('payment-outstanding')
    expect(isCompleted(now.overall)).toBe(false)

    // They come back and pay. Nothing about fulfilment is touched.
    await assertSucceeds(setDoc(doc(db, 'orderPayments', 'o1'), paymentDoc('o1')))

    now = await stateOf('o1')
    expect(now.fulfillment).toBe('delivered')
    expect(now.state.status).toBe('paid')
    expect(now.overall).toBe('completed')
    expect(isCompleted(now.overall)).toBe(true)
    // And the payment accountability survived the whole journey intact.
    expect(now.payment?.paidByStaffName).toBe('Alice')
    expect(now.payment?.paidByName).toBe('Shared Till')
  })

  it('does not complete an order that is paid but not yet delivered', async () => {
    await seed()
    const db = staffDb()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), orderDoc()))
    await assertSucceeds(
      setDoc(doc(db, 'orderFulfillment', 'o1'), await stepDocAt(db, 'o1', 'preparing')),
    )
    await assertSucceeds(
      updateDoc(doc(db, 'orderFulfillment', 'o1'), await stepDocAt(db, 'o1', 'ready')),
    )

    // Paying early is ordinary at a counter, and it does not finish the order.
    await assertSucceeds(setDoc(doc(db, 'orderPayments', 'o1'), paymentDoc('o1')))

    const now = await stateOf('o1')
    expect(now.state.status).toBe('paid')
    expect(now.fulfillment).toBe('ready')
    expect(now.overall).toBe('ready')
    expect(isCompleted(now.overall)).toBe(false)

    // Handing it over is what completes it.
    await assertSucceeds(
      updateDoc(doc(db, 'orderFulfillment', 'o1'), await stepDocAt(db, 'o1', 'delivered')),
    )
    expect((await stateOf('o1')).overall).toBe('completed')
  })

  it('stops a voided order progressing, and never reports it as completed', async () => {
    await seed()
    const db = staffDb()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), orderDoc()))
    await assertSucceeds(
      setDoc(doc(db, 'orderFulfillment', 'o1'), await stepDocAt(db, 'o1', 'preparing')),
    )

    await assertSucceeds(
      setDoc(doc(adminDb(), 'orderVoids', 'o1'), {
        orderId: 'o1',
        reason: 'Customer left',
        amount: TOTAL,
        voidedAt: new Date(),
        voidedBy: ADMIN_UID,
        voidedByName: 'Ada Admin',
        initiatedByStaffId: ADMIN_UID,
        initiatedByStaffName: 'Ada Admin',
      }),
    )

    // The kitchen cannot carry on with a cancelled sale.
    await assertFails(
      updateDoc(doc(db, 'orderFulfillment', 'o1'), await stepDocAt(db, 'o1', 'ready')),
    )

    const now = await stateOf('o1')
    expect(now.overall).toBe('voided')
    expect(isCompleted(now.overall)).toBe(false)
  })

  it('reads a legacy order as delivered, so history is not stuck in the queue', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'orders', 'legacy'),
        orderDoc({
          number: 9,
          paymentMethod: 'cash',
          cashTendered: CASH_GIVEN,
          changeGiven: CHANGE,
        }),
      )
    })

    const now = await stateOf('legacy')
    // Rung up and handed over in one motion, so both axes are already finished.
    expect(now.fulfillment).toBe('delivered')
    expect(now.state.status).toBe('paid')
    expect(now.overall).toBe('completed')
  })
})

describe('Test 7b - operator accountability across a whole order', () => {
  const ALICE = { id: 'alice', name: 'Alice' }
  const BOB = { id: 'bob', name: 'Bob' }

  it('records Alice and Bob on the steps each actually made, and neither overwrites the other', async () => {
    await seed()
    const db = staffDb()

    // Alice takes the order...
    await assertSucceeds(
      setDoc(doc(db, 'orders', 'o1'), orderDoc({ staffId: 'alice', staffName: 'Alice' })),
    )

    // ...Alice starts preparing it...
    await assertSucceeds(moveOrder(db, 'o1', 'pending', 'preparing', ALICE))
    // ...Bob takes over and marks it ready...
    await assertSucceeds(moveOrder(db, 'o1', 'preparing', 'ready', BOB))
    // ...and Alice hands it over.
    await assertSucceeds(moveOrder(db, 'o1', 'ready', 'delivered', ALICE))

    // Bob then takes the money.
    await assertSucceeds(
      setDoc(
        doc(db, 'orderPayments', 'o1'),
        paymentDoc('o1', { paidByStaffId: 'bob', paidByStaffName: 'Bob' }),
      ),
    )

    const now = await stateOf('o1')
    expect(now.overall).toBe('completed')

    // Order attribution: unchanged, still Alice, still on the shared account.
    expect(now.order.staffName).toBe('Alice')
    expect(now.order.createdByName).toBe('Shared Till')
    // Payment attribution: Bob took the money.
    expect(now.payment?.paidByStaffName).toBe('Bob')
    expect(now.payment?.paidByName).toBe('Shared Till')

    // Fulfilment: the parent shows only the last mover...
    const current = await getDoc(doc(db, 'orderFulfillment', 'o1'))
    expect(current.data()?.updatedByStaffName).toBe('Alice')

    // ...and the journal holds who did each individual step. This is the assertion the
    // whole subcollection exists for: Bob marking it ready did NOT erase Alice starting it.
    const entries = await getDocs(collection(db, 'orderFulfillment', 'o1', 'transitions'))
    expect(entries.size).toBe(3)

    const byStep = new Map(entries.docs.map((d) => [`${d.data().from}->${d.data().to}`, d.data()]))
    expect(byStep.get('pending->preparing')?.updatedByStaffName).toBe('Alice')
    expect(byStep.get('preparing->ready')?.updatedByStaffName).toBe('Bob')
    expect(byStep.get('ready->delivered')?.updatedByStaffName).toBe('Alice')

    // Every step keeps the shared Firebase account alongside the person, and every step is
    // attributed to the one signed-in credential - no individual accounts anywhere.
    for (const entry of entries.docs) {
      expect(entry.data().updatedBy).toBe(STAFF_UID)
      expect(entry.data().updatedByName).toBe('Shared Till')
    }
  })

  it('refuses a step naming an operator who is not who they say', async () => {
    await seed()
    const db = staffDb()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), orderDoc()))

    await assertFails(moveOrder(db, 'o1', 'pending', 'preparing', { id: 'alice', name: 'Bob' }))
    await assertFails(moveOrder(db, 'o1', 'pending', 'preparing', { id: 'ghost', name: 'Ghost' }))

    // Nothing was written, so the order is still pending.
    expect((await stateOf('o1')).fulfillment).toBe('pending')
  })

  it('lets the till fall back to the shared account when no operator is selected', async () => {
    await seed()
    const db = staffDb()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), orderDoc()))

    // The self-operator form, always available, which is what keeps an admin working
    // without a roster selection.
    await assertSucceeds(
      moveOrder(db, 'o1', 'pending', 'preparing', { id: STAFF_UID, name: 'Shared Till' }),
    )
    expect((await stateOf('o1')).fulfillment).toBe('preparing')
  })
})
