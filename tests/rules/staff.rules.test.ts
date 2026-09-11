import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const ADMIN_UID = 'admin-uid'
const STAFF_UID = 'staff-uid'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ordering-system-staff-rules-test',
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

afterEach(async () => {
  await testEnv.clearFirestore()
})

const staffMember = (over: Record<string, unknown> = {}) => ({
  name: 'Alice',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

/** A valid order attributed to the active staff member "Alice" (id `alice`). */
const order = (over: Record<string, unknown> = {}) => ({
  number: 1,
  businessDate: '2026-09-11',
  lines: [{ menuItemId: 'i1', name: 'Flat White', unitPrice: 1250, quantity: 1 }],
  total: 1250,
  // Phase 7: every order records how it is served. Dine-in carries a table number;
  // a takeaway must not carry the key at all.
  orderType: 'dine_in',
  tableNumber: '5',
  // No payment fields: an order is placed unpaid, and the rules refuse one that claims
  // otherwise. Payment lives in orderPayments/{orderId} — see payments.rules.test.ts.
  createdAt: new Date(),
  createdBy: STAFF_UID,
  createdByName: 'Shared Till',
  staffId: 'alice',
  staffName: 'Alice',
  ...over,
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
      displayName: 'Shared Till',
      role: 'staff',
      active: staffActive,
      createdAt: new Date(),
    })
    await setDoc(doc(db, 'staffMembers', 'alice'), staffMember())
    await setDoc(doc(db, 'staffMembers', 'bob'), staffMember({ name: 'Bob', active: false }))
    await setDoc(doc(db, 'orders', 'existing'), order())
  })
}

describe('staff identities: who may read and manage them', () => {
  it('lets active staff READ the roster — the till picker needs it', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    const snapshot = await assertSucceeds(getDocs(collection(db, 'staffMembers')))
    expect(snapshot.size).toBe(2)
  })

  it('DENIES staff creating, renaming or deactivating a staff member', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'staffMembers', 'sarah'), staffMember({ name: 'Sarah' })))
    await assertFails(updateDoc(doc(db, 'staffMembers', 'alice'), { name: 'Mallory' }))
    await assertFails(updateDoc(doc(db, 'staffMembers', 'alice'), { active: false }))
  })

  it('lets an admin create, rename and deactivate', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'staffMembers', 'sarah'), staffMember({ name: 'Sarah' })))
    await assertSucceeds(setDoc(doc(db, 'staffMembers', 'alice'), staffMember({ name: 'Alicia' })))
    await assertSucceeds(setDoc(doc(db, 'staffMembers', 'alice'), staffMember({ active: false })))
  })

  it('denies a deactivated admin', async () => {
    await seed({ adminActive: false })
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'staffMembers', 'sarah'), staffMember({ name: 'Sarah' })))
  })

  it('denies anonymous reads and writes', async () => {
    await seed()
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDocs(collection(db, 'staffMembers')))
    await assertFails(setDoc(doc(db, 'staffMembers', 'sarah'), staffMember({ name: 'Sarah' })))
  })

  it('denies a deactivated staff account reading the roster', async () => {
    await seed({ staffActive: false })
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(getDocs(collection(db, 'staffMembers')))
  })

  it('refuses DELETION outright, for everyone — history points at these records', async () => {
    await seed()
    for (const uid of [ADMIN_UID, STAFF_UID]) {
      const db = testEnv.authenticatedContext(uid).firestore()
      await assertFails(deleteDoc(doc(db, 'staffMembers', 'alice')))
    }
  })

  it('rejects an empty, over-long or non-string name and a non-boolean active flag', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'staffMembers', 'x'), staffMember({ name: '' })))
    await assertFails(setDoc(doc(db, 'staffMembers', 'x'), staffMember({ name: 'x'.repeat(61) })))
    await assertFails(setDoc(doc(db, 'staffMembers', 'x'), staffMember({ name: 42 })))
    await assertFails(setDoc(doc(db, 'staffMembers', 'x'), staffMember({ active: 'yes' })))
  })
})

describe('order attribution: the selected staff member must be real, active and correctly named', () => {
  it('accepts an order attributed to an active staff member', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), order()))
  })

  it('REFUSES an order with no staff attribution at all', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    const { staffId: _id, staffName: _name, ...withoutStaff } = order()
    await assertFails(setDoc(doc(db, 'orders', 'o1'), withoutStaff))
  })

  it('refuses an empty staffId or staffName', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'o1'), order({ staffId: '' })))
    await assertFails(setDoc(doc(db, 'orders', 'o1'), order({ staffName: '' })))
  })

  it('refuses an order naming a staff member that does not exist', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orders', 'o1'), order({ staffId: 'ghost', staffName: 'Ghost' })),
    )
  })

  it('refuses an order attributed to an INACTIVE staff member', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'o1'), order({ staffId: 'bob', staffName: 'Bob' })))
  })

  it('refuses a staffName that does not match the member’s current name', async () => {
    // Stops a sale being pinned on a colleague by sending someone else's name.
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'o1'), order({ staffName: 'Bob' })))
    await assertFails(setDoc(doc(db, 'orders', 'o1'), order({ staffName: 'alice' })))
  })

  it('accepts the new name immediately after a rename, and refuses the old one', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'staffMembers', 'alice'),
        staffMember({ name: 'Alicia' }),
      )
    })
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'o1'), order({ staffName: 'Alice' })))
    await assertSucceeds(setDoc(doc(db, 'orders', 'o2'), order({ staffName: 'Alicia' })))
  })
})

describe('the till can always sell: the signed-in account is itself an operator', () => {
  it('accepts an order attributed to the signed-in account', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(
      setDoc(doc(db, 'orders', 'o1'), order({ staffId: STAFF_UID, staffName: 'Shared Till' })),
    )
  })

  it('accepts it even when the roster is EMPTY — the regression this guards', async () => {
    // A staff-role user cannot create staff identities. If the roster were the only source
    // of operators, an empty one would stop the stall trading with no way to recover.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'users', STAFF_UID), {
        uid: STAFF_UID,
        email: 'staff@example.com',
        displayName: 'Shared Till',
        role: 'staff',
        active: true,
        createdAt: new Date(),
      })
    })
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(
      setDoc(doc(db, 'orders', 'o1'), order({ staffId: STAFF_UID, staffName: 'Shared Till' })),
    )
  })

  it('accepts it when every named identity is deactivated', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), 'staffMembers', 'alice'),
        staffMember({ active: false }),
      )
    })
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(
      setDoc(doc(db, 'orders', 'o1'), order({ staffId: STAFF_UID, staffName: 'Shared Till' })),
    )
  })

  it('refuses a self-attribution whose name is not the account’s display name', async () => {
    // Self-attribution is still verified — it is not a hole to write any name through.
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orders', 'o1'), order({ staffId: STAFF_UID, staffName: 'Somebody Else' })),
    )
  })

  it('refuses attributing to ANOTHER account’s uid', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orders', 'o1'), order({ staffId: ADMIN_UID, staffName: 'Ada Admin' })),
    )
  })

  it('lets an admin attribute to their own account too', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(
      setDoc(
        doc(db, 'orders', 'o1'),
        order({ createdBy: ADMIN_UID, staffId: ADMIN_UID, staffName: 'Ada Admin' }),
      ),
    )
  })
})

describe('regressions: Phase 1–5 guarantees still hold', () => {
  it('still refuses an order attributed to another Firebase account', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'o1'), order({ createdBy: ADMIN_UID })))
  })

  it('still refuses to update or delete an order, for admin and staff alike', async () => {
    await seed()
    for (const uid of [ADMIN_UID, STAFF_UID]) {
      const db = testEnv.authenticatedContext(uid).firestore()
      await assertFails(updateDoc(doc(db, 'orders', 'existing'), { staffName: 'Bob' }))
      await assertFails(deleteDoc(doc(db, 'orders', 'existing')))
    }
  })

  it('still refuses staff access to cost data', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(getDocs(collection(db, 'menuItemCosts')))
    await assertFails(getDocs(collection(db, 'menuItemCostHistory')))
  })

  it('still refuses staff voiding a sale', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orderVoids', 'existing'), {
        orderId: 'existing',
        reason: 'nope',
        amount: 1250,
        voidedAt: new Date(),
        voidedBy: STAFF_UID,
        voidedByName: 'Shared Till',
      }),
    )
  })

  it('still refuses a float total, and now refuses any payment on the order', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'o1'), order({ total: 12.5 })))
    // Adding operator attribution did not create a way to smuggle payment onto an order.
    await assertFails(setDoc(doc(db, 'orders', 'o1'), order({ paymentMethod: 'cash' })))
    await assertFails(setDoc(doc(db, 'orders', 'o1'), order({ cashTendered: 2000 })))
  })
})
