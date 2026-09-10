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
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const ADMIN_UID = 'admin-uid'
const STAFF_UID = 'staff-uid'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ordering-system-menu-rules-test',
    firestore: {
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

afterEach(async () => {
  await testEnv.clearFirestore()
})

const CATEGORY = {
  name: 'Coffee',
  sortOrder: 1,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

/** A valid item. Individual tests spread this and break one field on purpose. */
const ITEM = {
  name: 'Flat White',
  description: 'Double ristretto, steamed milk',
  categoryId: 'cat-1',
  price: 1250, // whole sen — never a float
  sortOrder: 1,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

/** Seeds profiles and one category/item with rules bypassed, as an admin would have. */
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
    await setDoc(doc(db, 'categories', 'cat-1'), CATEGORY)
    await setDoc(doc(db, 'menuItems', 'item-1'), ITEM)
    await setDoc(doc(db, 'menuItemCosts', 'item-1'), { cost: 400, updatedAt: new Date() })
    // A second real item with no cost recorded. Cost tests target this rather than an
    // invented id, so that a refusal proves the thing under test (validation, role) and
    // not merely that the item was missing.
    await setDoc(doc(db, 'menuItems', 'item-2'), { ...ITEM, name: 'Long Black' })
  })
}

describe('menu rules: reading', () => {
  it('denies anonymous reads of categories and menu items', async () => {
    await seed()
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'categories', 'cat-1')))
    await assertFails(getDoc(doc(db, 'menuItems', 'item-1')))
    await assertFails(getDocs(collection(db, 'menuItems')))
  })

  it('lets active staff read the whole catalog — they serve from it', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(getDoc(doc(db, 'categories', 'cat-1')))
    const items = await assertSucceeds(getDocs(collection(db, 'menuItems')))
    expect(items.size).toBe(2)
  })

  it('denies a deactivated staff member', async () => {
    await seed({ staffActive: false })
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(getDoc(doc(db, 'menuItems', 'item-1')))
  })

  it('denies a signed-in user with no profile document', async () => {
    await seed()
    const db = testEnv.authenticatedContext('ghost-uid').firestore()
    await assertFails(getDoc(doc(db, 'menuItems', 'item-1')))
  })
})

describe('menu rules: staff cannot write', () => {
  it('denies staff creating, updating or deleting a menu item', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'menuItems', 'item-2'), ITEM))
    await assertFails(updateDoc(doc(db, 'menuItems', 'item-1'), { price: 1 }))
    await assertFails(deleteDoc(doc(db, 'menuItems', 'item-1')))
  })

  it('denies staff creating, updating or deleting a category', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'categories', 'cat-2'), CATEGORY))
    await assertFails(updateDoc(doc(db, 'categories', 'cat-1'), { name: 'Tea' }))
    await assertFails(deleteDoc(doc(db, 'categories', 'cat-1')))
  })

  it('denies staff discounting an item to zero — the obvious abuse', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(updateDoc(doc(db, 'menuItems', 'item-1'), { price: 0 }))
  })
})

describe('menu rules: admin can write', () => {
  it('lets an admin create, update and delete menu items', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'menuItems', 'item-2'), ITEM))
    await assertSucceeds(updateDoc(doc(db, 'menuItems', 'item-1'), { price: 990 }))
    await assertSucceeds(deleteDoc(doc(db, 'menuItems', 'item-1')))
  })

  it('lets an admin create, update and delete categories', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'categories', 'cat-2'), CATEGORY))
    await assertSucceeds(updateDoc(doc(db, 'categories', 'cat-1'), { name: 'Hot Coffee' }))
    await assertSucceeds(deleteDoc(doc(db, 'categories', 'cat-1')))
  })

  it('denies a deactivated admin, so revoking access is immediate', async () => {
    await seed({ adminActive: false })
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'menuItems', 'item-2'), ITEM))
    await assertFails(getDoc(doc(db, 'menuItems', 'item-1')))
  })
})

describe('menu rules: price and shape validation', () => {
  it('rejects a float price — money must be whole sen', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'menuItems', 'bad'), { ...ITEM, price: 12.5 }))
    await assertFails(updateDoc(doc(db, 'menuItems', 'item-1'), { price: 9.99 }))
  })

  it('rejects a negative price', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'menuItems', 'bad'), { ...ITEM, price: -1 }))
  })

  it('rejects a price sent as a string', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'menuItems', 'bad'), { ...ITEM, price: '1250' }))
  })

  it('rejects an empty or over-long item name', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'menuItems', 'bad'), { ...ITEM, name: '' }))
    await assertFails(setDoc(doc(db, 'menuItems', 'bad'), { ...ITEM, name: 'x'.repeat(81) }))
  })

  it('rejects an item with no category', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'menuItems', 'bad'), { ...ITEM, categoryId: '' }))
  })

  it('rejects a non-boolean active flag and a float sortOrder', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'menuItems', 'bad'), { ...ITEM, active: 'yes' }))
    await assertFails(setDoc(doc(db, 'menuItems', 'bad'), { ...ITEM, sortOrder: 1.5 }))
  })

  it('rejects an over-long description but allows omitting it', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'menuItems', 'bad'), { ...ITEM, description: 'x'.repeat(301) }),
    )
    const { description: _omitted, ...withoutDescription } = ITEM
    await assertSucceeds(setDoc(doc(db, 'menuItems', 'ok'), withoutDescription))
  })

  it('rejects an empty or over-long category name', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'categories', 'bad'), { ...CATEGORY, name: '' }))
    await assertFails(setDoc(doc(db, 'categories', 'bad'), { ...CATEGORY, name: 'x'.repeat(61) }))
  })
})

describe('menu rules: cost is admin-only', () => {
  it('denies staff reading an item cost — the whole reason cost has its own collection', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(getDoc(doc(db, 'menuItemCosts', 'item-1')))
    await assertFails(getDocs(collection(db, 'menuItemCosts')))
  })

  it('denies anonymous reads of costs', async () => {
    await seed()
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'menuItemCosts', 'item-1')))
  })

  it('keeps cost off the menu item itself, so reading the menu cannot leak it', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    const snapshot = await assertSucceeds(getDoc(doc(db, 'menuItems', 'item-1')))
    // If a later change ever moves cost onto the item document, this fails loudly.
    expect(snapshot.get('cost')).toBeUndefined()
  })

  it('denies staff writing a cost', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'menuItemCosts', 'item-2'), { cost: 100 }))
    await assertFails(updateDoc(doc(db, 'menuItemCosts', 'item-1'), { cost: 1 }))
    await assertFails(deleteDoc(doc(db, 'menuItemCosts', 'item-1')))
  })

  it('lets an admin read, write and delete costs', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    const snapshot = await assertSucceeds(getDoc(doc(db, 'menuItemCosts', 'item-1')))
    expect(snapshot.get('cost')).toBe(400)
    await assertSucceeds(setDoc(doc(db, 'menuItemCosts', 'item-2'), { cost: 250 }))
    await assertSucceeds(updateDoc(doc(db, 'menuItemCosts', 'item-1'), { cost: 450 }))
    await assertSucceeds(deleteDoc(doc(db, 'menuItemCosts', 'item-1')))
  })

  it('denies a deactivated admin', async () => {
    await seed({ adminActive: false })
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(getDoc(doc(db, 'menuItemCosts', 'item-1')))
    await assertFails(setDoc(doc(db, 'menuItemCosts', 'item-2'), { cost: 250 }))
  })

  it('rejects a float, negative or non-numeric cost', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    // item-2 exists, so these can only be refused by validItemCost() — not by the
    // existence guard.
    await assertFails(setDoc(doc(db, 'menuItemCosts', 'item-2'), { cost: 4.5 }))
    await assertFails(setDoc(doc(db, 'menuItemCosts', 'item-2'), { cost: -1 }))
    await assertFails(setDoc(doc(db, 'menuItemCosts', 'item-2'), { cost: '400' }))
  })
})

describe('menu rules: a cost cannot be orphaned at creation', () => {
  it('denies a cost for a menu item that does not exist', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    // Valid shape, admin caller — refused purely because there is no such menu item.
    await assertFails(setDoc(doc(db, 'menuItemCosts', 'no-such-item'), { cost: 400 }))
  })

  it('allows a cost for an item that exists', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'menuItemCosts', 'item-2'), { cost: 400 }))
  })

  it('allows an item and its cost created together in one batch', async () => {
    // This is the app's real create path (see createMenuItem in menu-api.ts) and the
    // reason the rule uses existsAfter rather than exists: at the moment the cost write
    // is evaluated, the item does not exist yet — it lands in the same batch.
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    const batch = writeBatch(db)
    batch.set(doc(db, 'menuItems', 'item-3'), { ...ITEM, name: 'Cortado' })
    batch.set(doc(db, 'menuItemCosts', 'item-3'), { cost: 380 })
    await assertSucceeds(batch.commit())
  })

  it('denies a batch that writes a cost while deleting its item', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    const batch = writeBatch(db)
    batch.delete(doc(db, 'menuItems', 'item-1'))
    batch.set(doc(db, 'menuItemCosts', 'item-1'), { cost: 999 })
    await assertFails(batch.commit())
  })
})

describe('menu rules: default deny still holds', () => {
  it('denies an admin writing to a collection no rule covers yet', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'unmappedCollection', 'doc-1'), { anything: 1 }))
  })
})
