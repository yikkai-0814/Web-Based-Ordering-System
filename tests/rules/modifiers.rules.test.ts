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

/**
 * Translations on a modifier option, and exactly how far these rules reach.
 *
 * An option's `names` map sits inside the `options` LIST, and rules cannot iterate a list.
 * So — precisely as with the `name` and `priceAdjustment` sitting beside it, neither of which
 * has ever been checked here — the group document is validated around the option and the
 * option's own contents are validated at both ends of the app: `validateOptionNames` on the
 * way out, `parseOptionNames` on the way in.
 *
 * These tests pin that boundary honestly rather than implying a check that does not exist.
 * What the rules DO still guarantee is the part that matters most for this feature: only an
 * admin can write any of it, so a staff account cannot rename an option in any language.
 */
describe('modifier option translations', () => {
  const translated = (over: Record<string, unknown> = {}) =>
    group({
      options: [
        {
          id: 'add-egg',
          name: 'Fried Egg',
          names: { ms: 'Telur Goreng', zh: '煎蛋' },
          priceAdjustment: 100,
          active: true,
          ...over,
        },
      ],
    })

  it('lets an admin write an option carrying Malay and Chinese names', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(adminDb(), 'modifierGroups', 'translated'), translated()))
  })

  it('lets an admin write an option with an empty names map, as the editor sends', async () => {
    await seed()
    await assertSucceeds(
      setDoc(doc(adminDb(), 'modifierGroups', 'plain'), translated({ names: {} })),
    )
  })

  it('still reads back for staff, who need the names to take an order', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'modifierGroups', 'translated'), translated())
    })

    const snapshot = await assertSucceeds(getDoc(doc(staffDb(), 'modifierGroups', 'translated')))
    expect(snapshot.get('options')[0].names).toEqual({ ms: 'Telur Goreng', zh: '煎蛋' })
  })

  it('refuses a staff account adding a translation to an option', async () => {
    await seed()
    await assertFails(setDoc(doc(staffDb(), 'modifierGroups', 'translated'), translated()))
  })

  it('refuses a staff account changing a translation that already exists', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'modifierGroups', 'translated'), translated())
    })

    await assertFails(
      updateDoc(doc(staffDb(), 'modifierGroups', 'translated'), {
        options: [
          {
            id: 'add-egg',
            name: 'Fried Egg',
            names: { ms: 'Telur Mata' },
            priceAdjustment: 100,
            active: true,
          },
        ],
      }),
    )
  })

  it('refuses a `names` map on the GROUP, which is not a thing this feature added', async () => {
    // Group names are not translated. An unknown top-level field is refused here because the
    // group document's own key set IS something rules can check.
    await seed()
    await assertFails(
      setDoc(doc(adminDb(), 'modifierGroups', 'bad'), group({ names: { ms: 'Tambahan' } })),
    )
  })

  it('cannot refuse a bad names map INSIDE an option — which is why the parse discards it', async () => {
    // Stated rather than hidden: rules cannot iterate `options`, so an `en` key, an unknown
    // language and a non-string value all get past them. The guarantee that none of those
    // reaches a till is parseOptionNames', and tests/unit/option-names.test.ts holds it.
    await seed()
    await assertSucceeds(
      setDoc(
        doc(adminDb(), 'modifierGroups', 'hand-written'),
        translated({ names: { en: 'Something Else', fr: 'Œuf', ms: 7 } }),
      ),
    )
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
/**
 * What an option COSTS lives apart from what it adds to the bill, and is admin-only.
 *
 * The separation is not stylistic. `modifierGroups` is staff-readable — the till cannot ask
 * "extra egg?" without it — and Firestore grants or denies whole documents, so a cost field
 * beside `priceAdjustment` would be a cost every staff account could read. These tests are
 * what makes "staff cannot see modifier cost" a checked property rather than a claim.
 */
describe('modifier option costs are admin-only', () => {
  const GROUP_ID = 'existing'
  const OPTION_ID = 'veg-none'
  const COST_ID = `${GROUP_ID}__${OPTION_ID}`

  const cost = (over: Record<string, unknown> = {}) => ({
    groupId: GROUP_ID,
    optionId: OPTION_ID,
    cost: 40,
    updatedAt: new Date(),
    ...over,
  })

  async function seedCost() {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'modifierOptionCosts', COST_ID), cost())
    })
  }

  it('lets an admin write a cost and read it back', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(adminDb(), 'modifierOptionCosts', COST_ID), cost()))
    const snapshot = await assertSucceeds(getDoc(doc(adminDb(), 'modifierOptionCosts', COST_ID)))
    expect(snapshot.get('cost')).toBe(40)
  })

  it('lets an admin update a cost', async () => {
    await seed()
    await seedCost()
    await assertSucceeds(setDoc(doc(adminDb(), 'modifierOptionCosts', COST_ID), cost({ cost: 60 })))
  })

  it('lets an admin list them, which is what the editor and the report both do', async () => {
    await seed()
    await seedCost()
    const all = await assertSucceeds(getDocs(collection(adminDb(), 'modifierOptionCosts')))
    expect(all.size).toBe(1)
  })

  it('refuses STAFF reading one — the whole reason this is a separate collection', async () => {
    await seed()
    await seedCost()
    await assertFails(getDoc(doc(staffDb(), 'modifierOptionCosts', COST_ID)))
  })

  it('refuses staff listing the collection', async () => {
    await seed()
    await seedCost()
    await assertFails(getDocs(collection(staffDb(), 'modifierOptionCosts')))
  })

  it('refuses staff writing one', async () => {
    await seed()
    await assertFails(setDoc(doc(staffDb(), 'modifierOptionCosts', COST_ID), cost()))
  })

  it('refuses staff editing a cost that already exists', async () => {
    await seed()
    await seedCost()
    await assertFails(updateDoc(doc(staffDb(), 'modifierOptionCosts', COST_ID), { cost: 0 }))
  })

  it('refuses an anonymous caller entirely', async () => {
    await seed()
    await seedCost()
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(anon, 'modifierOptionCosts', COST_ID)))
    await assertFails(setDoc(doc(anon, 'modifierOptionCosts', COST_ID), cost()))
  })

  it('leaves the GROUP staff-readable, which this change must not have disturbed', async () => {
    await seed()
    await seedCost()
    // Both halves of the design, asserted together: the question is public to the counter,
    // the cost of answering it is not.
    await assertSucceeds(getDoc(doc(staffDb(), 'modifierGroups', GROUP_ID)))
    await assertFails(getDoc(doc(staffDb(), 'modifierOptionCosts', COST_ID)))
  })

  it('refuses a cost for a group that does not exist', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(adminDb(), 'modifierOptionCosts', `ghost__${OPTION_ID}`),
        cost({ groupId: 'ghost' }),
      ),
    )
  })

  it('refuses a document whose fields disagree with the id it is filed under', async () => {
    await seed()
    // Filed under one option, claiming to be another: resolvable two ways, so refused.
    await assertFails(
      setDoc(doc(adminDb(), 'modifierOptionCosts', COST_ID), cost({ optionId: 'veg-normal' })),
    )
  })

  it('refuses a malformed or negative cost', async () => {
    await seed()
    for (const bad of [-1, 12.5, '40', null]) {
      await assertFails(setDoc(doc(adminDb(), 'modifierOptionCosts', COST_ID), cost({ cost: bad })))
    }
  })

  it('refuses a cost carrying a field the app does not write', async () => {
    await seed()
    await assertFails(setDoc(doc(adminDb(), 'modifierOptionCosts', COST_ID), cost({ margin: 100 })))
  })
})

/**
 * The journal behind historical resolution, with the same guarantees menuItemCostHistory has.
 *
 * Staff cannot read costs, so they cannot stamp one onto an order they ring up — reporting
 * resolves an option's cost by date from here instead. Append-only, because a trail that
 * could be rewritten would not be one.
 */
describe('modifier option cost history', () => {
  const GROUP_ID = 'existing'
  const OPTION_ID = 'veg-none'

  const entry = (uid: string, over: Record<string, unknown> = {}) => ({
    groupId: GROUP_ID,
    optionId: OPTION_ID,
    cost: 40,
    effectiveFrom: new Date(),
    recordedBy: uid,
    ...over,
  })

  it('lets an admin append an entry and read the journal', async () => {
    await seed()
    await assertSucceeds(
      setDoc(doc(adminDb(), 'modifierOptionCostHistory', 'e1'), entry(ADMIN_UID)),
    )
    await assertSucceeds(getDocs(collection(adminDb(), 'modifierOptionCostHistory')))
  })

  it('accepts a CLEARED cost, which records a real event rather than a gap', async () => {
    await seed()
    await assertSucceeds(
      setDoc(doc(adminDb(), 'modifierOptionCostHistory', 'e1'), entry(ADMIN_UID, { cost: null })),
    )
  })

  it('refuses staff reading or writing the journal', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'modifierOptionCostHistory', 'e1'), entry(ADMIN_UID))
    })
    await assertFails(getDoc(doc(staffDb(), 'modifierOptionCostHistory', 'e1')))
    await assertFails(getDocs(collection(staffDb(), 'modifierOptionCostHistory')))
    await assertFails(setDoc(doc(staffDb(), 'modifierOptionCostHistory', 'e2'), entry(STAFF_UID)))
  })

  it('refuses an entry credited to somebody else', async () => {
    await seed()
    await assertFails(setDoc(doc(adminDb(), 'modifierOptionCostHistory', 'e1'), entry(STAFF_UID)))
  })

  it('refuses an entry against a group that does not exist', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(adminDb(), 'modifierOptionCostHistory', 'e1'),
        entry(ADMIN_UID, { groupId: 'ghost' }),
      ),
    )
  })

  it('refuses an entry with no effective time, which could not be placed in history', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(adminDb(), 'modifierOptionCostHistory', 'e1'),
        entry(ADMIN_UID, { effectiveFrom: 'yesterday' }),
      ),
    )
  })

  it('is append-only — an entry cannot be edited or deleted, by anyone', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'modifierOptionCostHistory', 'e1'), entry(ADMIN_UID))
    })
    await assertFails(updateDoc(doc(adminDb(), 'modifierOptionCostHistory', 'e1'), { cost: 5 }))
    await assertFails(deleteDoc(doc(adminDb(), 'modifierOptionCostHistory', 'e1')))
  })
})
