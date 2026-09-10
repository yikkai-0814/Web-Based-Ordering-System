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
const DATE = '2026-09-11'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ordering-system-orders-rules-test',
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

afterEach(async () => {
  await testEnv.clearFirestore()
})

/** A well-formed cash order rung up by staff. Tests spread it and break one field. */
const cashOrder = (uid = STAFF_UID) => ({
  number: 1,
  businessDate: DATE,
  lines: [
    { menuItemId: 'i1', name: 'Flat White', unitPrice: 1250, quantity: 2 },
    { menuItemId: 'i2', name: 'Croissant', unitPrice: 690, quantity: 1 },
  ],
  total: 3190,
  paymentMethod: 'cash',
  cashTendered: 5000,
  changeGiven: 1810,
  createdAt: new Date(),
  createdBy: uid,
  createdByName: 'Sam Staff',
})

/** The non-cash method. Recorded only — no gateway confirms the money moved. */
const ewalletOrder = (uid = STAFF_UID) => ({
  ...cashOrder(uid),
  paymentMethod: 'ewallet',
  cashTendered: null,
  changeGiven: null,
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
    await setDoc(doc(db, 'menuItems', 'i1'), {
      name: 'Flat White',
      categoryId: 'c1',
      price: 1250,
      sortOrder: 1,
      active: true,
    })
    await setDoc(doc(db, 'orders', 'existing'), cashOrder())
  })
}

describe('order rules: who may ring up and read', () => {
  it('lets active staff create an order', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), cashOrder()))
  })

  it('lets an admin create an order too', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), cashOrder(ADMIN_UID)))
  })

  it('lets active staff read the day’s orders', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(getDoc(doc(db, 'orders', 'existing')))
    const all = await assertSucceeds(getDocs(collection(db, 'orders')))
    expect(all.size).toBe(1)
  })

  it('denies anonymous reads and writes', async () => {
    await seed()
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'orders', 'existing')))
    await assertFails(setDoc(doc(db, 'orders', 'o1'), cashOrder()))
  })

  it('denies a deactivated staff account', async () => {
    await seed({ staffActive: false })
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(getDoc(doc(db, 'orders', 'existing')))
    await assertFails(setDoc(doc(db, 'orders', 'o1'), cashOrder()))
  })

  it('denies attributing a sale to somebody else', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'o1'), cashOrder(OTHER_UID)))
  })
})

describe('order rules: orders are immutable', () => {
  it('denies staff updating or deleting an order', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(updateDoc(doc(db, 'orders', 'existing'), { total: 1 }))
    await assertFails(deleteDoc(doc(db, 'orders', 'existing')))
  })

  it('denies an ADMIN updating or deleting an order — a sale is a financial record', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(updateDoc(doc(db, 'orders', 'existing'), { total: 1 }))
    await assertFails(updateDoc(doc(db, 'orders', 'existing'), { paymentMethod: 'ewallet' }))
    await assertFails(deleteDoc(doc(db, 'orders', 'existing')))
  })

  it('denies overwriting an existing order via set', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'existing'), cashOrder(ADMIN_UID)))
  })
})

describe('order rules: field validation', () => {
  it('rejects a float or negative total', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...cashOrder(), total: 31.9 }))
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...cashOrder(), total: -1 }))
  })

  it('rejects an empty lines array', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...cashOrder(), lines: [] }))
  })

  it('rejects an unknown payment method', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...cashOrder(), paymentMethod: 'crypto' }))
    // 'card' and 'duitnow' are not in the enum; both must be refused like any other
    // unknown value, so a stale client cannot keep writing them.
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...cashOrder(), paymentMethod: 'card' }))
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), { ...cashOrder(), paymentMethod: 'duitnow' }),
    )
  })

  it('rejects a non-positive order number and a malformed business date', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...cashOrder(), number: 0 }))
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...cashOrder(), businessDate: '11/9/26' }))
  })
})

describe('order rules: cash tender must add up', () => {
  it('rejects cash tendered below the total', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), { ...cashOrder(), cashTendered: 3000, changeGiven: -190 }),
    )
  })

  it('rejects change that is not exactly tendered minus total', async () => {
    // Rules cannot sum the lines, but they can and do check this arithmetic.
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...cashOrder(), changeGiven: 1800 }))
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...cashOrder(), changeGiven: 0 }))
  })

  it('accepts exact tender with zero change', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(
      setDoc(doc(db, 'orders', 'o1'), { ...cashOrder(), cashTendered: 3190, changeGiven: 0 }),
    )
  })

  it('accepts an e-wallet order with null tender fields', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), ewalletOrder()))
  })

  it('rejects an e-wallet order that carries cash fields', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), {
        ...ewalletOrder(),
        cashTendered: 5000,
        changeGiven: 1810,
      }),
    )
  })

  it('rejects a cash order with null tender fields', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), {
        ...cashOrder(),
        cashTendered: null,
        changeGiven: null,
      }),
    )
  })
})

describe('counter rules: numbers cannot be skipped or reused', () => {
  it('allows creating the day’s counter at 1', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'counters', DATE), { lastNumber: 1 }))
  })

  it('refuses to start a day at anything but 1', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'counters', DATE), { lastNumber: 7 }))
  })

  it('allows advancing by exactly one', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'counters', DATE), { lastNumber: 4 })
    })
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(updateDoc(doc(db, 'counters', DATE), { lastNumber: 5 }))
  })

  it('refuses skipping, repeating or rewinding a number', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'counters', DATE), { lastNumber: 4 })
    })
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(updateDoc(doc(db, 'counters', DATE), { lastNumber: 6 }))
    await assertFails(updateDoc(doc(db, 'counters', DATE), { lastNumber: 4 }))
    await assertFails(updateDoc(doc(db, 'counters', DATE), { lastNumber: 3 }))
  })

  it('refuses deleting a counter', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'counters', DATE), { lastNumber: 4 })
    })
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(deleteDoc(doc(db, 'counters', DATE)))
  })
})

describe('cost history rules: admin-only and append-only', () => {
  const entry = (uid = ADMIN_UID) => ({
    itemId: 'i1',
    cost: 400,
    effectiveFrom: new Date(),
    recordedBy: uid,
  })

  it('denies staff reading or writing cost history', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(getDocs(collection(db, 'menuItemCostHistory')))
    await assertFails(setDoc(doc(db, 'menuItemCostHistory', 'h1'), entry(STAFF_UID)))
  })

  it('lets an admin append an entry and read history', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'menuItemCostHistory', 'h1'), entry()))
    await assertSucceeds(getDocs(collection(db, 'menuItemCostHistory')))
  })

  it('accepts a null cost, which records a cost being cleared', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'menuItemCostHistory', 'h1'), { ...entry(), cost: null }))
  })

  it('rejects a float or negative cost, and a mis-attributed entry', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'menuItemCostHistory', 'h1'), { ...entry(), cost: 4.5 }))
    await assertFails(setDoc(doc(db, 'menuItemCostHistory', 'h1'), { ...entry(), cost: -1 }))
    await assertFails(setDoc(doc(db, 'menuItemCostHistory', 'h1'), entry(STAFF_UID)))
  })

  it('refuses to update or delete history — correcting it is not editing it', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'menuItemCostHistory', 'h1'), entry())
    })
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(updateDoc(doc(db, 'menuItemCostHistory', 'h1'), { cost: 1 }))
    await assertFails(deleteDoc(doc(db, 'menuItemCostHistory', 'h1')))
  })

  it('denies a deactivated admin', async () => {
    await seed({ adminActive: false })
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(getDocs(collection(db, 'menuItemCostHistory')))
    await assertFails(setDoc(doc(db, 'menuItemCostHistory', 'h1'), entry()))
  })
})
