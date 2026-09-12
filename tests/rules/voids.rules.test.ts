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
  // Phase 7: every order records how it is served. Dine-in carries a table number;
  // a takeaway must not carry the key at all.
  orderType: 'dine_in',
  tableNumber: '5',
  // Placed unpaid; payment is a separate document, and the rules refuse an order that
  // carries any. Voiding is unaffected either way — see payments.rules.test.ts for the
  // interaction between the two.
  createdAt: new Date(),
  createdBy: STAFF_UID,
  createdByName: 'Sam Staff',
  staffId: 'alice',
  staffName: 'Alice',
})

/**
 * A well-formed void. Tests spread it and break one field on purpose.
 *
 * Defaults to an admin voiding their own sale, where the same person authorised and
 * initiated it. Phase 11's staff-initiated case overrides the initiator instead.
 */
const voidRecord = (uid = ADMIN_UID) => ({
  orderId: ORDER_ID,
  reason: 'Wrong item rung up',
  amount: ORDER_TOTAL,
  voidedAt: new Date(),
  voidedBy: uid,
  voidedByName: 'Ada Admin',
  initiatedByStaffId: uid,
  initiatedByStaffName: 'Ada Admin',
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
    await setDoc(doc(db, 'staffMembers', 'alice'), {
      name: 'Alice',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
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

/**
 * Phase 10. A void carries exactly the keys voidOrder writes, and names the admin who
 * actually wrote it — the record of a cancelled sale being the one an audit reads first.
 */
describe('void rules: the exact shape of a void', () => {
  it('refuses a void carrying a field voidOrder does not write', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orderVoids', ORDER_ID), { ...voidRecord(), refundMethod: 'cash' }),
    )
    await assertFails(
      setDoc(doc(db, 'orderVoids', ORDER_ID), { ...voidRecord(), approvedBy: STAFF_UID }),
    )
  })

  it('refuses a void recorded under somebody else’s name', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orderVoids', ORDER_ID), { ...voidRecord(), voidedByName: 'Sam Staff' }),
    )
  })
})

/**
 * Phase 11. A staff member may now START a void, but the write still has to arrive with an
 * admin's token — the app gets one by having a manager sign in on a second, throwaway Auth
 * session, so from the database's point of view nothing about who may void has changed.
 *
 * What is new is the second identity. A void now answers both "who authorised this" and
 * "who asked for it", and the rules verify the second the only way they can: the claimed
 * initiator must be a real, active identity whose CURRENT name matches. They cannot prove
 * that person was standing there — the authorising manager attests to that.
 */
describe('void rules: manager-authorised voids record both identities', () => {
  /** What the app writes when Sam asks and Ada approves. */
  const staffInitiated = () => ({
    ...voidRecord(),
    initiatedByStaffId: STAFF_UID,
    initiatedByStaffName: 'Sam Staff',
  })

  it('accepts a void authorised by an admin and initiated by the till account', async () => {
    await seed()
    // Written by the ADMIN's context, because that is what the manager's session is.
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orderVoids', ORDER_ID), staffInitiated()))

    // Read back as the STAFF member: they must be able to see that the sale was cancelled.
    const staffDb = testEnv.authenticatedContext(STAFF_UID).firestore()
    const snapshot = await getDoc(doc(staffDb, 'orderVoids', ORDER_ID))
    expect(snapshot.get('voidedBy')).toBe(ADMIN_UID)
    expect(snapshot.get('initiatedByStaffId')).toBe(STAFF_UID)
  })

  it('accepts a named roster member as the initiator', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(
      setDoc(doc(db, 'orderVoids', ORDER_ID), {
        ...voidRecord(),
        initiatedByStaffId: 'alice',
        initiatedByStaffName: 'Alice',
      }),
    )
  })

  it('STILL denies staff voiding, whatever the initiator says', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    // The staff account naming itself as initiator, and naming the admin as authoriser —
    // the two shapes a tampered client would try. Both are refused because the TOKEN is not
    // an admin's, which no field on the document can change.
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), staffInitiated()))
    await assertFails(
      setDoc(doc(db, 'orderVoids', ORDER_ID), {
        ...staffInitiated(),
        voidedBy: ADMIN_UID,
        voidedByName: 'Ada Admin',
      }),
    )
  })

  it('refuses a void that does not say who initiated it', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    const withoutInitiator = { ...voidRecord() } as Record<string, unknown>
    delete withoutInitiator.initiatedByStaffId
    delete withoutInitiator.initiatedByStaffName
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), withoutInitiator))
  })

  it('refuses an initiator nobody has heard of', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orderVoids', ORDER_ID), {
        ...voidRecord(),
        initiatedByStaffId: 'ghost',
        initiatedByStaffName: 'Nobody',
      }),
    )
  })

  it('refuses a deactivated initiator', async () => {
    await seed({ staffActive: false })
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'orderVoids', ORDER_ID), staffInitiated()))
  })

  it('refuses an initiator name that is not their current one', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    // The uid is real and active, but the name attached to it is not theirs — which is how
    // a void would be pinned on a colleague.
    await assertFails(
      setDoc(doc(db, 'orderVoids', ORDER_ID), {
        ...staffInitiated(),
        initiatedByStaffName: 'Someone Else',
      }),
    )
    await assertFails(
      setDoc(doc(db, 'orderVoids', ORDER_ID), {
        ...voidRecord(),
        initiatedByStaffId: 'alice',
        initiatedByStaffName: 'Alicia',
      }),
    )
  })

  it('refuses an empty or over-long initiator name', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orderVoids', ORDER_ID), { ...staffInitiated(), initiatedByStaffName: '' }),
    )
    await assertFails(
      setDoc(doc(db, 'orderVoids', ORDER_ID), {
        ...staffInitiated(),
        initiatedByStaffName: 'x'.repeat(61),
      }),
    )
  })
})
