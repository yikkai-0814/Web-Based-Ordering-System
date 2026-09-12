import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, doc, getDocs, query, where } from 'firebase/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Phase 5 adds **no new collections and no new rules** — reporting is read-only over data
 * the reader is already permitted to see.
 *
 * These tests pin the boundary the reports page depends on, so that the guarantee is
 * asserted rather than assumed. If a later phase ever loosens the cost collections to
 * "make reporting easier", this suite fails.
 */

const ADMIN_UID = 'admin-uid'
const STAFF_UID = 'staff-uid'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ordering-system-reporting-rules-test',
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
  })

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    const { setDoc } = await import('firebase/firestore')
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
      displayName: 'Sam Staff',
      role: 'staff',
      active: true,
      createdAt: new Date(),
    })
    // Deliberately left in the ORIGINAL shape: inline payment, no staff attribution, and
    // no order type or table number. Seeded with the rules disabled, exactly as a real
    // pre-Phase-7 document came to exist — so this doubles as the proof that a legacy order
    // stays readable, listable and range-queryable after the create rules tightened.
    await setDoc(doc(db, 'orders', 'o1'), {
      number: 1,
      businessDate: '2026-09-10',
      lines: [{ menuItemId: 'i1', name: 'Flat White', unitPrice: 1250, quantity: 1 }],
      total: 1250,
      paymentMethod: 'cash',
      cashTendered: 2000,
      changeGiven: 750,
      createdAt: new Date(),
      createdBy: STAFF_UID,
      createdByName: 'Sam Staff',
    })
    await setDoc(doc(db, 'orderVoids', 'o1'), {
      orderId: 'o1',
      reason: 'Mis-rung',
      amount: 1250,
      voidedAt: new Date(),
      voidedBy: ADMIN_UID,
      voidedByName: 'Ada Admin',
      initiatedByStaffId: ADMIN_UID,
      initiatedByStaffName: 'Ada Admin',
    })
    // Two more orders, each settled the modern way, so the id-scoped sidecar fetch has
    // something to include AND something to leave out. `o3` is in a different month, which
    // is exactly the case the old whole-collection read could not avoid loading.
    for (const [id, businessDate] of [
      ['o2', '2026-09-11'],
      ['o3', '2026-10-05'],
    ] as const) {
      await setDoc(doc(db, 'orders', id), {
        number: 1,
        businessDate,
        lines: [{ menuItemId: 'i1', name: 'Flat White', unitPrice: 1250, quantity: 1 }],
        total: 1250,
        orderType: 'takeaway',
        createdAt: new Date(),
        createdBy: STAFF_UID,
        createdByName: 'Sam Staff',
        staffId: STAFF_UID,
        staffName: 'Sam Staff',
      })
      await setDoc(doc(db, 'orderPayments', id), {
        orderId: id,
        method: 'cash',
        amount: 1250,
        cashTendered: 1250,
        changeGiven: 0,
        paidAt: new Date(),
        paidBy: STAFF_UID,
        paidByName: 'Sam Staff',
        paidByStaffId: STAFF_UID,
        paidByStaffName: 'Sam Staff',
      })
    }
    await setDoc(doc(db, 'menuItemCosts', 'i1'), { cost: 400, updatedAt: new Date() })
    await setDoc(doc(db, 'menuItemCostHistory', 'h1'), {
      itemId: 'i1',
      cost: 400,
      effectiveFrom: new Date(),
      recordedBy: ADMIN_UID,
    })
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

describe('reporting boundary: what an admin may read', () => {
  it('can read every collection a report needs', async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(getDocs(collection(db, 'orders')))
    await assertSucceeds(getDocs(collection(db, 'orderVoids')))
    await assertSucceeds(getDocs(collection(db, 'menuItemCosts')))
    await assertSucceeds(getDocs(collection(db, 'menuItemCostHistory')))
  })

  it('can run the date-range query the report uses', async () => {
    // Proves the range filter needs no composite index: an unindexed query would fail here.
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    const ranged = query(
      collection(db, 'orders'),
      where('businessDate', '>=', '2026-09-01'),
      where('businessDate', '<=', '2026-09-30'),
    )
    const snapshot = await assertSucceeds(getDocs(ranged))
    // o1 and o2 are in September; o3 is in October and must not be returned.
    expect(snapshot.docs.map((document) => document.id).sort()).toEqual(['o1', 'o2'])
  })
})

/**
 * A report used to read `orderPayments` and `orderVoids` whole. `orderPayments` holds one
 * document per paid order, so it grows exactly as fast as `orders` and a one-day report was
 * loading every payment the café had ever taken.
 *
 * It now fetches them by the ids of the orders in range, with the same chunked
 * `where('orderId', 'in', [...])` the orders workspace uses. No document shape changed and
 * no rule changed — these tests pin that the query is permitted and that it is exact.
 */
describe('reporting read scope: sidecars fetched by order id', () => {
  it('permits the chunked `in` query on both sidecar collections', async () => {
    // Also proves no composite index is needed: `in` on a single field is served by the
    // automatic index, and an unindexed query would fail here rather than pass.
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    for (const path of ['orderPayments', 'orderVoids']) {
      await assertSucceeds(
        getDocs(query(collection(db, path), where('orderId', 'in', ['o1', 'o2']))),
      )
    }
  })

  it('returns only the sidecars of the orders asked for', async () => {
    // The whole point of the change: a payment belonging to an order outside the range is
    // never downloaded, so it can never reach buildReport.
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    const snapshot = await assertSucceeds(
      getDocs(query(collection(db, 'orderPayments'), where('orderId', 'in', ['o1', 'o2']))),
    )

    expect(snapshot.docs.map((document) => document.id)).toEqual(['o2'])
  })

  it('finds no payment for a legacy order, which is what makes it read as paid inline', async () => {
    // `o1` carries paymentMethod on the order itself and has no payment document at all.
    // resolvePaymentState reads that as paid; the scoped fetch simply returns nothing for
    // it, exactly as the whole-collection read did.
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    const snapshot = await assertSucceeds(
      getDocs(query(collection(db, 'orderPayments'), where('orderId', 'in', ['o1']))),
    )

    expect(snapshot.empty).toBe(true)
  })

  it('lets staff run the same scoped query, which the orders workspace depends on', async () => {
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(
      getDocs(query(collection(db, 'orderPayments'), where('orderId', 'in', ['o1', 'o2']))),
    )
  })

  it('denies an anonymous reader the scoped query', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(
      getDocs(query(collection(db, 'orderPayments'), where('orderId', 'in', ['o1', 'o2']))),
    )
  })
})

describe('reporting boundary: staff must never reach cost data', () => {
  it('DENIES staff reading current costs', async () => {
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(getDocs(collection(db, 'menuItemCosts')))
  })

  it('DENIES staff reading cost history — the source of every profit figure', async () => {
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(getDocs(collection(db, 'menuItemCostHistory')))
  })

  it('still lets staff read orders and voids, which reporting also uses', async () => {
    // Staff can already compute revenue from these; cost is the protected part, and it is
    // protected at the database, not by hiding a page.
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(getDocs(collection(db, 'orders')))
    await assertSucceeds(getDocs(collection(db, 'orderVoids')))
  })

  it('denies an anonymous reader everything reporting touches', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDocs(collection(db, 'orders')))
    await assertFails(getDocs(collection(db, 'orderVoids')))
    await assertFails(getDocs(collection(db, 'menuItemCosts')))
    await assertFails(getDocs(collection(db, 'menuItemCostHistory')))
  })
})
