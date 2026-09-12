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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
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

/**
 * The display name each seeded account actually has. `createdByName` is now checked against
 * the profile behind `createdBy`, so a fixture that changes one without the other is refused
 * as the spoof it would be — which is the point of the rule, but makes it a poor way to
 * write "the same order, rung up by the admin". Deriving the pair from one argument keeps
 * every caller honest.
 */
const ACCOUNT_NAMES: Record<string, string> = {
  [ADMIN_UID]: 'Ada Admin',
  [STAFF_UID]: 'Sam Staff',
  [OTHER_UID]: 'Otto Other',
}

/**
 * A well-formed order as the till now writes one: placed, and carrying nothing about
 * payment. Tests spread it and break one field.
 */
const placedOrder = (uid = STAFF_UID) => ({
  number: 1,
  businessDate: DATE,
  lines: [
    { menuItemId: 'i1', name: 'Flat White', unitPrice: 1250, quantity: 2 },
    { menuItemId: 'i2', name: 'Croissant', unitPrice: 690, quantity: 1 },
  ],
  // Phase 7: every order records how it is served. Dine-in carries a table number;
  // a takeaway must not carry the key at all.
  orderType: 'dine_in',
  tableNumber: '5',
  total: 3190,
  createdAt: new Date(),
  createdBy: uid,
  createdByName: ACCOUNT_NAMES[uid] ?? 'Sam Staff',
  // Phase 6: every order names the staff identity that operated the till.
  staffId: 'alice',
  staffName: 'Alice',
})

/**
 * An order in the shape written before payment became a separate step. No client may create
 * one of these any more, so it is only ever seeded with the rules disabled — which is
 * exactly how it got there in a real database, too.
 */
const legacyPaidOrder = (uid = STAFF_UID) => ({
  ...placedOrder(uid),
  paymentMethod: 'cash',
  cashTendered: 5000,
  changeGiven: 1810,
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
    await setDoc(doc(db, 'staffMembers', 'alice'), {
      name: 'Alice',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await setDoc(doc(db, 'orders', 'existing'), placedOrder())
  })
}

describe('order rules: who may ring up and read', () => {
  it('lets active staff create an order', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), placedOrder()))
  })

  it('lets an admin create an order too', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), placedOrder(ADMIN_UID)))
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
    await assertFails(setDoc(doc(db, 'orders', 'o1'), placedOrder()))
  })

  it('denies a deactivated staff account', async () => {
    await seed({ staffActive: false })
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(getDoc(doc(db, 'orders', 'existing')))
    await assertFails(setDoc(doc(db, 'orders', 'o1'), placedOrder()))
  })

  it('denies attributing a sale to somebody else', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'o1'), placedOrder(OTHER_UID)))
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
    await assertFails(setDoc(doc(db, 'orders', 'existing'), placedOrder(ADMIN_UID)))
  })
})

describe('order rules: field validation', () => {
  it('rejects a float or negative total', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), total: 31.9 }))
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), total: -1 }))
  })

  it('rejects an empty lines array', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), lines: [] }))
  })

  it('rejects a non-positive order number and a malformed business date', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), number: 0 }))
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), businessDate: '11/9/26' }),
    )
  })
})

describe('order rules: order type and table number', () => {
  /** The fixture minus the table number key — absent, not null. */
  const withoutTable = (over: Record<string, unknown> = {}) => {
    const { tableNumber: _table, ...rest } = { ...placedOrder(), ...over }
    return rest
  }

  /** A valid takeaway: order type present, table number key absent entirely. */
  const takeaway = () => withoutTable({ orderType: 'takeaway' })

  it('accepts a dine-in order with a table number', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), placedOrder()))
  })

  it('accepts a takeaway that carries no table number at all', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), takeaway()))
  })

  it('accepts every shape of table label a café might use', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    for (const [index, tableNumber] of ['5', '12', 'A3', 'T12', '12B', 'AAAAAAAA'].entries()) {
      await assertSucceeds(
        setDoc(doc(db, 'orders', `ok-${index}`), { ...placedOrder(), tableNumber }),
      )
    }
  })

  // A table number is an identifier, not a resource. Nothing reserves or de-duplicates one.
  it('lets several separate orders share the same table number', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orders', 'a'), { ...placedOrder(), tableNumber: '5' }))
    await assertSucceeds(
      setDoc(doc(db, 'orders', 'b'), { ...placedOrder(), number: 2, tableNumber: '5' }),
    )
    await assertSucceeds(
      setDoc(doc(db, 'orders', 'c'), { ...placedOrder(), number: 3, tableNumber: '5' }),
    )
  })

  it('refuses a dine-in order with no table number key', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), withoutTable({ orderType: 'dine_in' })))
  })

  it('refuses a dine-in order whose table number is blank or whitespace', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    // The rules have no trim(), so this is enforced by the pattern rather than by length —
    // a client that skipped the form must not be able to write "   ".
    for (const tableNumber of ['', ' ', '   ', '\t']) {
      await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), tableNumber }))
    }
  })

  it('refuses a table number longer than eight characters', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), tableNumber: 'A'.repeat(9) }),
    )
  })

  it('refuses a table number containing anything but letters and digits', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    for (const tableNumber of ['A-3', 'T 12', '5!', '#4', '5.0']) {
      await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), tableNumber }))
    }
  })

  it('refuses a table number that is not a string', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), tableNumber: 5 }))
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), tableNumber: true }))
  })

  // The load-bearing half of the invariant: a takeaway has no table, and null is presence.
  it('refuses a takeaway that carries a table number', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), orderType: 'takeaway' }))
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...takeaway(), tableNumber: null }))
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...takeaway(), tableNumber: '' }))
  })

  it('refuses an order type the café does not offer', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    for (const orderType of ['delivery', 'dine-in', 'DINE_IN', 'eat_in', '', 5, null]) {
      await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), orderType }))
    }
  })

  // A new order may not be written in the pre-Phase-7 shape, even though existing ones in
  // that shape must still read back — see tests/unit/order-type.test.ts.
  it('refuses an order with no order type at all', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    const { orderType: _o, ...noType } = placedOrder()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), noType))
  })

  it('refuses an admin doing any of it either', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(ADMIN_UID), orderType: 'delivery' }),
    )
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(ADMIN_UID), tableNumber: '   ' }),
    )
  })

  // Order type and table number are written once and never change, like everything else on
  // an order. A mistyped table is corrected by voiding and ringing again.
  it('refuses changing the order type or table number afterwards', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(updateDoc(doc(db, 'orders', 'existing'), { tableNumber: '9' }))
    await assertFails(updateDoc(doc(db, 'orders', 'existing'), { orderType: 'takeaway' }))
  })
})

describe('order rules: an order may not declare itself paid', () => {
  // The load-bearing guard of the whole pay-later design. If a client could write payment
  // onto the order it creates, it could mint a sale that is paid on arrival — never
  // appearing as outstanding, and never leaving the orderPayments audit trail.
  it('rejects an order carrying a payment method', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), paymentMethod: 'cash' }))
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), paymentMethod: 'ewallet' }),
    )
  })

  it('rejects an order carrying cash tendered or change', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), cashTendered: 5000 }))
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), changeGiven: 0 }))
  })

  it('rejects the full legacy shape, even null payment fields', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), legacyPaidOrder()))
    // Null is still the field being present, and present is what is refused. A stale client
    // sending nulls must fail loudly rather than write an order nothing can classify.
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), {
        ...placedOrder(),
        paymentMethod: null,
        cashTendered: null,
        changeGiven: null,
      }),
    )
  })

  it('accepts an order with no payment fields at all', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), placedOrder()))
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

/**
 * Phase 10. Two kinds of check, both about what a write may CONTAIN rather than who may
 * make it:
 *
 *   * the document must carry exactly the keys createOrder writes — nothing reads a stray
 *     field today, which is precisely why an invented one must not be able to get in and
 *     wait for something that does;
 *   * the account name must belong to the account it names. The operator half of the pair
 *     has been verified since Phase 6; this is the other half.
 */
describe('order rules: the exact shape of a sale', () => {
  it('refuses an order carrying a field the till does not write', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    // Each of these is a plausible field a future phase might add. None may be minted by a
    // client before the phase that defines what it means.
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), discount: 100 }))
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), paid: true }))
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), status: 'delivered' }))
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), refunded: 0 }))
    await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), note: 'extra shot' }))
  })

  it('refuses an order missing a field the till always writes', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    const { staffName: _name, ...noOperatorName } = placedOrder()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), noOperatorName))
    const { createdByName: _account, ...noAccountName } = placedOrder()
    await assertFails(setDoc(doc(db, 'orders', 'bad'), noAccountName))
  })

  it('still allows a takeaway order, which legitimately omits tableNumber', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    const { tableNumber: _table, ...takeaway } = placedOrder()
    await assertSucceeds(setDoc(doc(db, 'orders', 'o1'), { ...takeaway, orderType: 'takeaway' }))
  })

  it('refuses a sale attributed to the caller under somebody else’s name', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    // The uid is the caller's own, so the existing createdBy check passes. What is being
    // faked is the NAME the sale will be read under for the rest of its life.
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), createdByName: 'Ada Admin' }),
    )
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), createdByName: 'Nobody At All' }),
    )
  })

  it('refuses a business date that is not a date', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    // Ten characters each, which is all the old check asked for.
    for (const businessDate of ['xxxxxxxxxx', '2026/09/11', '11-09-2026', '          ']) {
      await assertFails(setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), businessDate }))
    }
    // Right idea, wrong shape: businessDateOf always zero-pads.
    await assertFails(
      setDoc(doc(db, 'orders', 'bad'), { ...placedOrder(), businessDate: '2026-9-11' }),
    )
  })
})

describe('counter rules: the day it counts for', () => {
  it('refuses a counter opened under a key that is not a business date', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    // A counter under a malformed key would mint order numbers for a day no screen queries.
    await assertFails(setDoc(doc(db, 'counters', 'not-a-date'), { lastNumber: 1 }))
    await assertFails(setDoc(doc(db, 'counters', '2026-9-11'), { lastNumber: 1 }))
  })

  it('refuses a counter carrying anything but lastNumber', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(setDoc(doc(db, 'counters', DATE), { lastNumber: 1, businessDate: DATE }))
  })

  it('still opens a counter for a well-formed date', async () => {
    await seed()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertSucceeds(setDoc(doc(db, 'counters', DATE), { lastNumber: 1 }))
  })
})

describe('cost history rules: an entry must point at a real item', () => {
  const entryFor = (itemId: string) => ({
    itemId,
    cost: 400,
    effectiveFrom: new Date(),
    recordedBy: ADMIN_UID,
  })

  it('refuses an entry journalled against a menu item that does not exist', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    // Worse than stray data: reporting resolves an order line's cost by itemId, so this
    // would be a cost that silently applies to nothing — and the journal is append-only,
    // so it could never be taken back out.
    await assertFails(setDoc(doc(db, 'menuItemCostHistory', 'h1'), entryFor('no-such-item')))
  })

  it('refuses an entry carrying a field the journal does not have', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(
      setDoc(doc(db, 'menuItemCostHistory', 'h1'), { ...entryFor('i1'), reason: 'supplier' }),
    )
  })

  it('still allows an item and its first history entry in one batch', async () => {
    await seed()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    // The reason the guard uses existsAfter: at the moment this entry is evaluated the item
    // does not exist yet. This is createMenuItem's real path.
    const batch = writeBatch(db)
    batch.set(doc(db, 'menuItems', 'i2'), {
      name: 'Cortado',
      categoryId: 'c1',
      price: 990,
      sortOrder: 2,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    batch.set(doc(collection(db, 'menuItemCostHistory')), entryFor('i2'))
    await assertSucceeds(batch.commit())
  })
})
