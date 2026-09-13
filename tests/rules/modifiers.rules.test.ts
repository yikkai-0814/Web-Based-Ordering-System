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

/**
 * Menu item customisation is ADMIN-CONFIGURED and STAFF-READABLE.
 *
 * The split is the same one menuItems and categories already use, and for the same reason: a
 * staff account cannot take an order without knowing what to ask, and must not be able to
 * invent an option or change what one costs.
 *
 * What these rules deliberately do NOT check is inside the options array — rules cannot
 * iterate a list. That is the same limitation the `lines` array on an order has, and it is
 * stated here rather than left to be discovered.
 */

const ADMIN_UID = 'admin-uid'
const STAFF_UID = 'staff-uid'
const ITEM_ID = 'item-chicken-chop-rice'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ordering-system-modifier-rules-test',
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

afterEach(async () => {
  await testEnv.clearFirestore()
})

const group = (over: Record<string, unknown> = {}) => ({
  itemId: ITEM_ID,
  name: 'Vegetables',
  selection: 'single',
  required: true,
  sortOrder: 0,
  active: true,
  options: [
    { id: 'veg-normal', name: 'Normal', priceAdjustment: 0, active: true },
    { id: 'veg-none', name: 'No vegetables', priceAdjustment: 0, active: true },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
})

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
    await setDoc(doc(db, 'menuItems', ITEM_ID), {
      name: 'Chicken Chop Rice',
      categoryId: 'mains',
      price: 800,
      sortOrder: 0,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await setDoc(doc(db, 'modifierGroups', 'existing'), group())
  })
}

const staffDb = () => testEnv.authenticatedContext(STAFF_UID).firestore()
const adminDb = () => testEnv.authenticatedContext(ADMIN_UID).firestore()

describe('staff may read the configuration but never write it', () => {
  it('lets staff read a group, because they cannot take an order without it', async () => {
    await seed()
    const snapshot = await assertSucceeds(getDoc(doc(staffDb(), 'modifierGroups', 'existing')))
    expect(snapshot.get('name')).toBe('Vegetables')
  })

  it('lets staff list the configuration for the whole menu', async () => {
    await seed()
    await assertSucceeds(getDocs(collection(staffDb(), 'modifierGroups')))
  })

  it('refuses a staff account creating a group', async () => {
    await seed()
    await assertFails(setDoc(doc(staffDb(), 'modifierGroups', 'new'), group()))
  })

  it('refuses a staff account editing one — including its prices', async () => {
    await seed()
    await assertFails(
      updateDoc(doc(staffDb(), 'modifierGroups', 'existing'), {
        options: [{ id: 'veg-none', name: 'No vegetables', priceAdjustment: -500, active: true }],
        updatedAt: new Date(),
      }),
    )
  })

  it('refuses a staff account deleting one', async () => {
    await seed()
    await assertFails(deleteDoc(doc(staffDb(), 'modifierGroups', 'existing')))
  })

  it('refuses an anonymous caller entirely', async () => {
    await seed()
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(anon, 'modifierGroups', 'existing')))
    await assertFails(setDoc(doc(anon, 'modifierGroups', 'new'), group()))
  })
})

describe('an admin configures it', () => {
  it('creates a group', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(adminDb(), 'modifierGroups', 'new'), group()))
  })

  it('creates a multi-select optional group, which is a different rule entirely', async () => {
    await seed()
    await assertSucceeds(
      setDoc(
        doc(adminDb(), 'modifierGroups', 'addons'),
        group({
          name: 'Add-ons',
          selection: 'multiple',
          required: false,
          options: [{ id: 'add-egg', name: 'Extra egg', priceAdjustment: 100, active: true }],
        }),
      ),
    )
  })

  it('updates one, including deactivating it', async () => {
    await seed()
    await assertSucceeds(
      setDoc(doc(adminDb(), 'modifierGroups', 'existing'), group({ active: false })),
    )
  })

  it('deletes one', async () => {
    await seed()
    await assertSucceeds(deleteDoc(doc(adminDb(), 'modifierGroups', 'existing')))
  })
})

describe('what the rules refuse even from an admin', () => {
  it('refuses a group attached to no menu item', async () => {
    await seed()
    await assertFails(
      setDoc(doc(adminDb(), 'modifierGroups', 'stray'), group({ itemId: 'no-such-item' })),
    )
  })

  it('refuses an empty itemId', async () => {
    await seed()
    await assertFails(setDoc(doc(adminDb(), 'modifierGroups', 'stray'), group({ itemId: '' })))
  })

  it('refuses a selection mode that is not one of the two', async () => {
    await seed()
    await assertFails(setDoc(doc(adminDb(), 'modifierGroups', 'bad'), group({ selection: 'lots' })))
  })

  it('refuses a non-boolean required flag', async () => {
    await seed()
    await assertFails(setDoc(doc(adminDb(), 'modifierGroups', 'bad'), group({ required: 'yes' })))
  })

  it('refuses a group with no options at all', async () => {
    await seed()
    await assertFails(setDoc(doc(adminDb(), 'modifierGroups', 'bad'), group({ options: [] })))
  })

  it('refuses an unbounded number of options', async () => {
    await seed()
    const many = Array.from({ length: 31 }, (_, index) => ({
      id: `o${index}`,
      name: `Option ${index}`,
      priceAdjustment: 0,
      active: true,
    }))
    await assertFails(setDoc(doc(adminDb(), 'modifierGroups', 'bad'), group({ options: many })))
  })

  it('refuses an over-long name', async () => {
    await seed()
    await assertFails(
      setDoc(doc(adminDb(), 'modifierGroups', 'bad'), group({ name: 'x'.repeat(61) })),
    )
  })

  it('refuses a fractional sort order', async () => {
    await seed()
    await assertFails(setDoc(doc(adminDb(), 'modifierGroups', 'bad'), group({ sortOrder: 1.5 })))
  })

  it('refuses an unexpected field', async () => {
    await seed()
    await assertFails(setDoc(doc(adminDb(), 'modifierGroups', 'bad'), group({ cost: 500 })))
  })

  it('refuses a missing timestamp', async () => {
    await seed()
    const { updatedAt: _dropped, ...withoutTimestamp } = group()
    await assertFails(setDoc(doc(adminDb(), 'modifierGroups', 'bad'), withoutTimestamp))
  })
})

describe('the cost collection is untouched by any of this', () => {
  it('still refuses staff the item cost, which is the reason it is a separate collection', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'menuItemCosts', ITEM_ID), {
        cost: 300,
        updatedAt: new Date(),
      })
    })
    // Customisation is readable by staff; cost is not, and adding one did not change the other.
    await assertSucceeds(getDoc(doc(staffDb(), 'modifierGroups', 'existing')))
    await assertFails(getDoc(doc(staffDb(), 'menuItemCosts', ITEM_ID)))
  })
})
