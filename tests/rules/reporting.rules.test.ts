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
    })
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
    expect(snapshot.size).toBe(1)
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
