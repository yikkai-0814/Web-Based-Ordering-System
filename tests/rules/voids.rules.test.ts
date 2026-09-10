import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const ADMIN_UID = 'admin-uid'
const STAFF_UID = 'staff-uid'
const OTHER_UID = 'other-uid'
const ORDER_ID = 'order-1'
const ORDER_TOTAL = 3190

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ordering-system-voids-rules-test',
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

afterEach(async () => {
  await testEnv.clearFirestore()
})

const order = () => ({
  number: 1,
  businessDate: '2026-09-11',
  lines: [{ menuItemId: 'i1', name: 'Flat White', unitPrice: 1250, quantity: 2 }],
  total: ORDER_TOTAL,
  paymentMethod: 'cash',
  cashTendered: 5000,
  changeGiven: 1810,
  createdAt: new Date(),
  createdBy: STAFF_UID,
  createdByName: 'Sam Staff',
})

/** A well-formed void. Tests spread it and break one field on purpose. */
const voidRecord = (uid = ADMIN_UID) => ({
  orderId: ORDER_ID,
  reason: 'Wrong item rung up',
  amount: ORDER_TOTAL,
  voidedAt: new Date(),
  voidedBy: uid,
  voidedByName: 'Ada Admin',
})

async function seed({ adminActive = true, staffActive = true } = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'users', ADMIN_UID), {
      uid: ADMIN_UID,
      email: 'admin@example.com',
      displayName: 'Ada Admin',
      role: 'admin',
      active: adminActive,
      createdAt: new Date(),
    })
    await setDoc(doc(db, 'users', STAFF_UID), {
      uid: STAFF_UID,
      email: 'staff@example.com',
      displayName: 'Sam Staff',
      role: 'staff',
      active: staffActive,
      createdAt: new Date(),
    })
    await setDoc(doc(db, 'orders', ORDER_ID), order())
  })
}

describe('void rules: who may void', () => {
  it('lets an admin void a sale', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orderVoids', ORDER_ID), voidRecord()))
  })

  it('DENIES staff voiding a sale — the core control of this phase', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), voidRecord(STAFF_UID)))
  })

  it('denies a deactivated admin', async () => {
    await seed({ adminActive: false })
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), voidRecord()))
  })

  it('denies anonymous reads and writes', async () => {
    await seed()
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), voidRecord()))
    await assertFails(getDoc(doc(db, 'orderVoids', ORDER_ID)))
  })

  it('lets active staff READ voids — the orders list must not hide a cancelled sale', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'orderVoids', ORDER_ID), voidRecord())
    })
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    const snapshot = await assertSucceeds(getDoc(doc(db, 'orderVoids', ORDER_ID)))
    expect(snapshot.get('reason')).toBe('Wrong item rung up')
    await assertSucceeds(getDocs(collection(db, 'orderVoids')))
  })

  it('denies a deactivated staff member reading voids', async () => {
    await seed({ staffActive: false })
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(getDoc(doc(db, 'orderVoids', ORDER_ID)))
  })
})

describe('void rules: a void must match a real sale', () => {
  it('denies a void for an order that does not exist', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orderVoids', 'no-such-order'), { ...voidRecord(), orderId: 'no-such-order' }),
    )
  })

  it('denies an amount that disagrees with the order total', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), { ...voidRecord(), amount: 1 }))
    await assertFails(
      setDoc(doc(db, 'orderVoids', ORDER_ID), { ...voidRecord(), amount: ORDER_TOTAL + 1 }),
    )
  })

  it('denies a float or negative amount', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), { ...voidRecord(), amount: 31.9 }))
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), { ...voidRecord(), amount: -1 }))
  })

  it('denies an orderId that disagrees with the document id', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orderVoids', ORDER_ID), { ...voidRecord(), orderId: 'something-else' }),
    )
  })

  it('denies a void attributed to somebody else', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), voidRecord(OTHER_UID)))
  })
})

describe('void rules: a reason is required', () => {
  it('denies an empty reason', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), { ...voidRecord(), reason: '' }))
  })

  it('denies an over-long reason but accepts one at the limit', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orderVoids', ORDER_ID), { ...voidRecord(), reason: 'x'.repeat(201) }),
    )
    await assertSucceeds(
      setDoc(doc(db, 'orderVoids', ORDER_ID), { ...voidRecord(), reason: 'x'.repeat(200) }),
    )
  })

  it('denies a non-string reason', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), { ...voidRecord(), reason: 42 }))
  })
})

describe('void rules: a void is final', () => {
  async function seedWithVoid() {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'orderVoids', ORDER_ID), voidRecord())
    })
  }

  it('refuses to update a void, even for the admin who made it', async () => {
    await seedWithVoid()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(updateDoc(doc(db, 'orderVoids', ORDER_ID), { reason: 'Changed my mind' }))
  })

  it('refuses to delete a void — there is no un-voiding', async () => {
    await seedWithVoid()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(deleteDoc(doc(db, 'orderVoids', ORDER_ID)))
  })

  it('refuses to void the same order twice', async () => {
    // Falls out of keying by order id: the second write is an update, which is denied.
    await seedWithVoid()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), voidRecord()))
  })
})

describe('regression: orders are still immutable after adding voids', () => {
  // This phase is exactly where someone might be tempted to loosen the order rules to
  // "mark" a void. These assertions fail loudly if that ever happens.
  it('still refuses to update or delete an order, for admin and staff alike', async () => {
    await seed()
    for (const uid of [ADMIN_UID, STAFF_UID]) {
      const db = testEnv.authenticatedContext(uid).firestore()
      await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { total: 1 }))
      await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { voided: true }))
      await assertFails(deleteDoc(doc(db, 'orders', ORDER_ID)))
    }
  })

  it('still lets an active user create an order', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orders', 'order-2'), { ...order(), number: 2 }))
  })
})
