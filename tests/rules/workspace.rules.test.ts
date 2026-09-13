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
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * Phase 8: the queries the orders workspace and the fulfilment queue actually issue.
 *
 * The other rule suites check what may be WRITTEN. This one checks that the narrowed reads
 * the workspace depends on are permitted — a date-bounded list of orders, and the sidecars
 * fetched by the ids of the orders already loaded — and that narrowing a query grants nobody
 * anything they did not already have.
 *
 * It also runs a full ticket through the queue exactly as the board does, because the queue
 * writes through the same `setFulfillment` the receipt uses and must be refused in exactly
 * the same places.
 */

const ADMIN_UID = 'admin-uid'
const STAFF_UID = 'staff-uid'

const TODAY = '2026-09-12'
const YESTERDAY = '2026-09-11'
const TOTAL = 3190

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ordering-system-workspace-rules-test',
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

afterEach(async () => {
  await testEnv.clearFirestore()
})

const order = (over: Record<string, unknown> = {}) => ({
  number: 1,
  businessDate: TODAY,
  lines: [{ menuItemId: 'i1', name: 'Flat White', unitPrice: 1595, quantity: 2 }],
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

const step = (status: string, orderId: string, uid = STAFF_UID) => ({
  orderId,
  status,
  updatedAt: new Date(),
  updatedBy: uid,
  updatedByName: uid === ADMIN_UID ? 'Ada Admin' : 'Shared Till',
  updatedByStaffId: 'alice',
  updatedByStaffName: 'Alice',
})

const transition = (from: string, to: string, orderId: string, uid = STAFF_UID) => ({
  orderId,
  from,
  to,
  at: new Date(),
  updatedBy: uid,
  updatedByName: uid === ADMIN_UID ? 'Ada Admin' : 'Shared Till',
  updatedByStaffId: 'alice',
  updatedByStaffName: 'Alice',
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

/** `step()` built against what the document currently holds — see preparationFor. */
async function stepAt(
  db: ReturnType<typeof staffDb>,
  status: string,
  orderId: string,
  uid = STAFF_UID,
) {
  const existing = await getDoc(doc(db, 'orderFulfillment', orderId))
  const from = existing.exists() ? (existing.get('status') as string) : 'pending'
  const prior = existing.exists() ? { readyAt: existing.get('readyAt') ?? null } : { readyAt: null }

  return { ...step(status, orderId, uid), ...preparationFor(from, status, prior) }
}

/** A move written exactly as fulfillment-api.ts writes it: parent and journal in one batch. */
async function move(
  db: ReturnType<typeof staffDb>,
  {
    from,
    to,
    orderId,
    uid = STAFF_UID,
  }: { from: string; to: string; orderId: string; uid?: string },
) {
  const batch = writeBatch(db)
  batch.set(doc(db, 'orderFulfillment', orderId), await stepAt(db, to, orderId, uid))
  batch.set(
    doc(collection(db, 'orderFulfillment', orderId, 'transitions')),
    transition(from, to, orderId, uid),
  )
  return batch.commit()
}

/**
 * Two business dates of orders, so a date-bounded query has something to exclude, plus one
 * payment and one void to fetch by id.
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

    await setDoc(doc(db, 'staffMembers', 'alice'), {
      name: 'Alice',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await setDoc(doc(db, 'orders', 'today-1'), order({ number: 1 }))
    await setDoc(doc(db, 'orders', 'today-2'), order({ number: 2, orderType: 'takeaway' }))
    await setDoc(doc(db, 'orders', 'today-3'), order({ number: 3 }))
    await setDoc(doc(db, 'orders', 'yesterday-1'), order({ number: 1, businessDate: YESTERDAY }))

    await setDoc(doc(db, 'orderPayments', 'today-2'), {
      orderId: 'today-2',
      method: 'ewallet',
      amount: TOTAL,
      cashTendered: null,
      changeGiven: null,
      paidAt: new Date(),
      paidBy: STAFF_UID,
      paidByName: 'Shared Till',
      paidByStaffId: 'alice',
      paidByStaffName: 'Alice',
    })

    await setDoc(doc(db, 'orderVoids', 'today-3'), {
      orderId: 'today-3',
      reason: 'Rung up twice',
      amount: TOTAL,
      voidedAt: new Date(),
      voidedBy: ADMIN_UID,
      voidedByName: 'Ada Admin',
      initiatedByStaffId: ADMIN_UID,
      initiatedByStaffName: 'Ada Admin',
    })

    await setDoc(doc(db, 'orderFulfillment', 'today-1'), {
      ...step('preparing', 'today-1'),
      readyAt: null,
      deliveredAt: null,
    })
  })
}

const staffDb = () => testEnv.authenticatedContext(STAFF_UID).firestore()
const adminDb = () => testEnv.authenticatedContext(ADMIN_UID).firestore()
const anonDb = () => testEnv.unauthenticatedContext().firestore()

const ordersOn = (db: ReturnType<typeof staffDb>, businessDate: string) =>
  getDocs(query(collection(db, 'orders'), where('businessDate', '==', businessDate)))

const sidecarsFor = (db: ReturnType<typeof staffDb>, path: string, ids: string[]) =>
  getDocs(query(collection(db, path), where('orderId', 'in', ids)))

describe('date-scoped orders', () => {
  it('lets staff list one business date', async () => {
    await seed()
    await assertSucceeds(ordersOn(staffDb(), TODAY))
  })

  it('returns that date and nothing else', async () => {
    await seed()
    const snapshot = await ordersOn(staffDb(), TODAY)
    expect(snapshot.docs.map((document) => document.id).sort()).toEqual([
      'today-1',
      'today-2',
      'today-3',
    ])
  })

  it('reads an earlier date without loading the whole collection', async () => {
    await seed()
    const snapshot = await ordersOn(staffDb(), YESTERDAY)
    expect(snapshot.docs.map((document) => document.id)).toEqual(['yesterday-1'])
  })

  it('returns nothing for a date with no sales, rather than failing', async () => {
    await seed()
    const snapshot = await ordersOn(staffDb(), '2026-01-01')
    expect(snapshot.empty).toBe(true)
  })

  it('still refuses a signed-out caller — narrowing a query grants nothing', async () => {
    await seed()
    await assertFails(ordersOn(anonDb(), TODAY))
  })

  it('still refuses a deactivated account', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', STAFF_UID), {
        uid: STAFF_UID,
        email: 'staff@example.com',
        displayName: 'Shared Till',
        role: 'staff',
        active: false,
        createdAt: new Date(),
      })
    })
    await assertFails(ordersOn(staffDb(), TODAY))
  })
})

describe('sidecars fetched by order id', () => {
  it('lets staff read payments for the ids on screen', async () => {
    await seed()
    const snapshot = await sidecarsFor(staffDb(), 'orderPayments', [
      'today-1',
      'today-2',
      'today-3',
    ])
    expect(snapshot.docs.map((document) => document.id)).toEqual(['today-2'])
  })

  it('lets staff read voids for the ids on screen', async () => {
    // Staff must see that a sale was cancelled, or the list would lie to whoever is working
    // the till.
    await seed()
    const snapshot = await sidecarsFor(staffDb(), 'orderVoids', ['today-1', 'today-2', 'today-3'])
    expect(snapshot.docs.map((document) => document.id)).toEqual(['today-3'])
  })

  it('lets staff read fulfilment for the ids on screen', async () => {
    await seed()
    const snapshot = await sidecarsFor(staffDb(), 'orderFulfillment', ['today-1', 'today-2'])
    expect(snapshot.docs.map((document) => document.id)).toEqual(['today-1'])
  })

  it('excludes an id that was not asked for, so an earlier date cannot leak in', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'orderFulfillment', 'yesterday-1'), {
        ...step('ready', 'yesterday-1'),
      })
    })
    const snapshot = await sidecarsFor(staffDb(), 'orderFulfillment', ['today-1', 'today-2'])
    expect(snapshot.docs.map((document) => document.id)).toEqual(['today-1'])
  })

  it('refuses a signed-out caller for every sidecar', async () => {
    await seed()
    for (const path of ['orderPayments', 'orderVoids', 'orderFulfillment']) {
      await assertFails(sidecarsFor(anonDb(), path, ['today-1']))
    }
  })

  it('keeps admin-only collections admin-only however they are queried', async () => {
    // menuItemCosts has no orderId, so this is the nearest equivalent narrowing. It must
    // still be refused — the workspace's query shape is not a way round a read rule.
    await seed()
    await assertFails(getDocs(collection(staffDb(), 'menuItemCosts')))
    await assertSucceeds(getDocs(collection(adminDb(), 'menuItemCosts')))
  })
})

describe('fulfilment moved from the queue', () => {
  it('runs a ticket the whole way, one step at a time', async () => {
    await seed()
    const db = staffDb()
    await assertSucceeds(move(db, { from: 'pending', to: 'preparing', orderId: 'today-2' }))
    await assertSucceeds(move(db, { from: 'preparing', to: 'ready', orderId: 'today-2' }))
    await assertSucceeds(move(db, { from: 'ready', to: 'delivered', orderId: 'today-2' }))
  })

  it('refuses a skipped step, however the client asks for it', async () => {
    await seed()
    // today-1 is already preparing.
    await assertFails(move(staffDb(), { from: 'preparing', to: 'delivered', orderId: 'today-1' }))
  })

  it('refuses a first move that is not into preparing', async () => {
    await seed()
    await assertFails(move(staffDb(), { from: 'pending', to: 'ready', orderId: 'today-2' }))
    await assertFails(move(staffDb(), { from: 'pending', to: 'delivered', orderId: 'today-2' }))
  })

  it('refuses staff stepping an order backwards', async () => {
    await seed()
    await assertFails(move(staffDb(), { from: 'preparing', to: 'pending', orderId: 'today-1' }))
  })

  it('lets an admin correct a mis-tap by exactly one step back', async () => {
    await seed()
    await assertSucceeds(
      move(adminDb(), { from: 'preparing', to: 'pending', orderId: 'today-1', uid: ADMIN_UID }),
    )
  })

  it('refuses any move on a voided sale', async () => {
    // today-3 is voided. The board does not show it, and the rules refuse it anyway.
    await seed()
    await assertFails(move(staffDb(), { from: 'pending', to: 'preparing', orderId: 'today-3' }))
  })

  it('refuses a move that names an operator who is not who they say they are', async () => {
    await seed()
    const db = staffDb()
    const batch = writeBatch(db)
    batch.set(doc(db, 'orderFulfillment', 'today-2'), {
      ...(await stepAt(db, 'preparing', 'today-2')),
      updatedByStaffName: 'Someone Else',
    })
    batch.set(doc(collection(db, 'orderFulfillment', 'today-2', 'transitions')), {
      ...transition('pending', 'preparing', 'today-2'),
      updatedByStaffName: 'Someone Else',
    })
    await assertFails(batch.commit())
  })
})

describe('payment and void regressions', () => {
  it('still refuses payment against a voided sale', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', 'today-3'), {
        orderId: 'today-3',
        method: 'cash',
        amount: TOTAL,
        cashTendered: TOTAL,
        changeGiven: 0,
        paidAt: new Date(),
        paidBy: STAFF_UID,
        paidByName: 'Shared Till',
        paidByStaffId: 'alice',
        paidByStaffName: 'Alice',
      }),
    )
  })

  it('still refuses a second payment for the same order', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', 'today-2'), {
        orderId: 'today-2',
        method: 'cash',
        amount: TOTAL,
        cashTendered: TOTAL,
        changeGiven: 0,
        paidAt: new Date(),
        paidBy: STAFF_UID,
        paidByName: 'Shared Till',
        paidByStaffId: 'alice',
        paidByStaffName: 'Alice',
      }),
    )
  })

  it('still keeps voiding with admins', async () => {
    await seed()
    const record = {
      orderId: 'today-1',
      reason: 'Wrong item',
      amount: TOTAL,
      voidedAt: new Date(),
      voidedBy: STAFF_UID,
      voidedByName: 'Shared Till',
      // Phase 11's shape: the till initiated it, and only an admin's token can complete it.
      initiatedByStaffId: STAFF_UID,
      initiatedByStaffName: 'Shared Till',
    }
    await assertFails(setDoc(doc(staffDb(), 'orderVoids', 'today-1'), record))
    await assertSucceeds(
      setDoc(doc(adminDb(), 'orderVoids', 'today-1'), {
        ...record,
        voidedBy: ADMIN_UID,
        voidedByName: 'Ada Admin',
      }),
    )
  })

  it('still refuses any write to an order itself', async () => {
    await seed()
    await assertFails(setDoc(doc(adminDb(), 'orders', 'today-1'), order({ total: 1 })))
  })
})
