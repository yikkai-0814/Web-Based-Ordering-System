import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const ADMIN_UID = 'admin-uid'
const STAFF_UID = 'staff-uid'
const OTHER_UID = 'other-uid'
const DATE = '2026-09-11'

/** The order every test pays for: total RM 31.90. */
const UNPAID_ORDER_ID = 'order-unpaid'
/** An order written the old way, carrying payment inline. Already paid, by definition. */
const LEGACY_ORDER_ID = 'order-legacy'
const VOIDED_ORDER_ID = 'order-voided'
const TOTAL = 3190

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ordering-system-payments-rules-test',
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
 * A well-formed cash payment: RM 50.00 given for an RM 31.90 order, RM 18.10 back.
 *
 * Names both identities, as every payment must: the shared account that was signed in, and
 * the named operator who took the money.
 */
const cashPayment = (uid = STAFF_UID, orderId = UNPAID_ORDER_ID) => ({
  orderId,
  method: 'cash',
  amount: TOTAL,
  cashTendered: 5000,
  changeGiven: 1810,
  paidAt: new Date(),
  paidBy: uid,
  paidByName: 'Sam Staff',
  paidByStaffId: 'alice',
  paidByStaffName: 'Alice',
})

/** Recorded only — no gateway confirms the money moved, so there is nothing to count out. */
const ewalletPayment = (uid = STAFF_UID, orderId = UNPAID_ORDER_ID) => ({
  ...cashPayment(uid, orderId),
  method: 'ewallet',
  cashTendered: null,
  changeGiven: null,
})

const order = (over: Record<string, unknown> = {}) => ({
  number: 1,
  businessDate: DATE,
  lines: [{ menuItemId: 'i1', name: 'Flat White', unitPrice: 1595, quantity: 2 }],
  // Phase 7: every order records how it is served. Dine-in carries a table number;
  // a takeaway must not carry the key at all.
  orderType: 'dine_in',
  tableNumber: '5',
  total: TOTAL,
  createdAt: new Date(),
  createdBy: STAFF_UID,
  createdByName: 'Sam Staff',
  staffId: 'alice',
  staffName: 'Alice',
  ...over,
})

/** Drops the Phase 7 fields, for seeding a document as it would have existed before them. */
function legacyShaped(document: Record<string, unknown>): Record<string, unknown> {
  const { orderType: _orderType, tableNumber: _tableNumber, ...rest } = document
  return rest
}

async function seed({ staffActive = true } = {}) {
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
    // One shared Firebase account for the whole shift — Alice and Bob are operator
    // identities chosen after login, not accounts of their own.
    await setDoc(doc(db, 'users', STAFF_UID), {
      uid: STAFF_UID,
      email: 'staff@example.com',
      displayName: 'Sam Staff',
      role: 'staff',
      active: staffActive,
      createdAt: new Date(),
    })
    await setDoc(doc(db, 'users', OTHER_UID), {
      uid: OTHER_UID,
      email: 'other@example.com',
      displayName: 'Otto Other',
      role: 'staff',
      active: true,
      createdAt: new Date(),
    })

    for (const { id, name } of [
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob' },
      { id: 'retired', name: 'Rita Retired' },
    ]) {
      await setDoc(doc(db, 'staffMembers', id), {
        name,
        active: id !== 'retired',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }

    await setDoc(doc(db, 'orders', UNPAID_ORDER_ID), order())
    await setDoc(doc(db, 'orders', VOIDED_ORDER_ID), order({ number: 2 }))
    // Only creatable with the rules off, which is exactly how the real ones got there.
    await setDoc(
      doc(db, 'orders', LEGACY_ORDER_ID),
      // Genuinely pre-Phase-7: inline payment AND no order type, which is the shape real
      // legacy documents have. Strips the fixture's defaults rather than adding to them.
      legacyShaped(
        order({ number: 3, paymentMethod: 'cash', cashTendered: 5000, changeGiven: 1810 }),
      ),
    )

    await setDoc(doc(db, 'orderVoids', VOIDED_ORDER_ID), {
      orderId: VOIDED_ORDER_ID,
      reason: 'Wrong item rung up',
      amount: TOTAL,
      voidedAt: new Date(),
      voidedBy: ADMIN_UID,
      voidedByName: 'Ada Admin',
      initiatedByStaffId: ADMIN_UID,
      initiatedByStaffName: 'Ada Admin',
    })
  })
}

const staffDb = () => testEnv.authenticatedContext(STAFF_UID).firestore()
const adminDb = () => testEnv.authenticatedContext(ADMIN_UID).firestore()

describe('payment rules: who may record payment', () => {
  it('lets active staff record a cash payment — taking money is the job', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), cashPayment()))
  })

  it('lets active staff record an e-wallet payment', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), ewalletPayment()))
  })

  it('lets an admin record a payment too', async () => {
    await seed()
    await assertSucceeds(
      setDoc(doc(adminDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(ADMIN_UID),
        paidByName: 'Ada Admin',
      }),
    )
  })

  it('lets both roles read payments — the till must see what is still owed', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'orderPayments', UNPAID_ORDER_ID), cashPayment())
    })

    await assertSucceeds(getDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID)))
    const all = await assertSucceeds(getDocs(collection(staffDb(), 'orderPayments')))
    expect(all.size).toBe(1)
  })

  it('denies an anonymous caller', async () => {
    await seed()
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(doc(db, 'orderPayments', UNPAID_ORDER_ID), cashPayment()))
    await assertFails(getDoc(doc(db, 'orderPayments', UNPAID_ORDER_ID)))
  })

  it('denies a deactivated staff account', async () => {
    await seed({ staffActive: false })
    await assertFails(setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), cashPayment()))
    await assertFails(getDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID)))
  })

  it('denies recording a payment under somebody else’s name', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), cashPayment(OTHER_UID)),
    )
  })
})

describe('payment rules: an order cannot be paid twice', () => {
  it('refuses a second payment on an order already paid', async () => {
    await seed()
    // First payment: accepted.
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), cashPayment()))
    // Second: a write to a document that now exists, which is an update, which is denied.
    // This is the property that keying by the order id buys, not a check written by hand.
    await assertFails(setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), ewalletPayment()))
    await assertFails(
      setDoc(doc(adminDb(), 'orderPayments', UNPAID_ORDER_ID), cashPayment(ADMIN_UID)),
    )
  })

  it('refuses paying a legacy order, which already carries its payment inline', async () => {
    await seed()
    // Without the legacy guard this would succeed and the sale would be paid twice: once
    // at the till years ago, and once again now.
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderPayments', LEGACY_ORDER_ID),
        cashPayment(STAFF_UID, LEGACY_ORDER_ID),
      ),
    )
    await assertFails(
      setDoc(doc(adminDb(), 'orderPayments', LEGACY_ORDER_ID), {
        ...cashPayment(ADMIN_UID, LEGACY_ORDER_ID),
        paidByName: 'Ada Admin',
      }),
    )
  })
})

describe('payment rules: payments are final', () => {
  beforeEach(async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'orderPayments', UNPAID_ORDER_ID), cashPayment())
    })
  })

  it('denies staff editing or deleting a payment', async () => {
    await assertFails(updateDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), { amount: 1 }))
    await assertFails(deleteDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID)))
  })

  it('denies an ADMIN editing or deleting a payment — money taken is a financial record', async () => {
    await assertFails(
      updateDoc(doc(adminDb(), 'orderPayments', UNPAID_ORDER_ID), { method: 'ewallet' }),
    )
    await assertFails(
      updateDoc(doc(adminDb(), 'orderPayments', UNPAID_ORDER_ID), { cashTendered: 9999 }),
    )
    await assertFails(deleteDoc(doc(adminDb(), 'orderPayments', UNPAID_ORDER_ID)))
  })
})

describe('payment rules: a voided sale cannot be paid', () => {
  it('refuses payment against a voided order', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderPayments', VOIDED_ORDER_ID),
        cashPayment(STAFF_UID, VOIDED_ORDER_ID),
      ),
    )
  })

  it('refuses it for an admin as well', async () => {
    await seed()
    await assertFails(
      setDoc(doc(adminDb(), 'orderPayments', VOIDED_ORDER_ID), {
        ...cashPayment(ADMIN_UID, VOIDED_ORDER_ID),
        paidByName: 'Ada Admin',
      }),
    )
  })

  // Voiding is the existing correction mechanism and must keep working on a paid order —
  // there is deliberately no automated refund, only the void record.
  it('still lets an admin void an order that has been paid', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), cashPayment()))
    await assertSucceeds(
      setDoc(doc(adminDb(), 'orderVoids', UNPAID_ORDER_ID), {
        orderId: UNPAID_ORDER_ID,
        reason: 'Customer returned it',
        amount: TOTAL,
        voidedAt: new Date(),
        voidedBy: ADMIN_UID,
        voidedByName: 'Ada Admin',
        initiatedByStaffId: ADMIN_UID,
        initiatedByStaffName: 'Ada Admin',
      }),
    )
  })

  it('still refuses a staff account the ability to void a paid order', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), cashPayment()))
    // Recording payment grants staff nothing else. Voiding erases revenue and stays admin.
    await assertFails(
      setDoc(doc(staffDb(), 'orderVoids', UNPAID_ORDER_ID), {
        orderId: UNPAID_ORDER_ID,
        reason: 'Covering my till shortfall',
        amount: TOTAL,
        voidedAt: new Date(),
        voidedBy: STAFF_UID,
        voidedByName: 'Sam Staff',
        initiatedByStaffId: STAFF_UID,
        initiatedByStaffName: 'Sam Staff',
      }),
    )
  })
})

describe('payment rules: the figures must add up', () => {
  it('refuses an amount that is not the order total', async () => {
    await seed()
    const db = staffDb()
    // Paying RM 1 for an RM 31.90 order, and inflating the takings, are the same hole.
    await assertFails(
      setDoc(doc(db, 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        amount: 100,
        changeGiven: 4900,
      }),
    )
    await assertFails(
      setDoc(doc(db, 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        amount: 99999,
        cashTendered: 99999,
        changeGiven: 0,
      }),
    )
  })

  it('refuses cash tendered below the amount', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        cashTendered: 3000,
        changeGiven: -190,
      }),
    )
  })

  it('refuses change that is not exactly tendered minus the amount', async () => {
    await seed()
    const db = staffDb()
    await assertFails(
      setDoc(doc(db, 'orderPayments', UNPAID_ORDER_ID), { ...cashPayment(), changeGiven: 1800 }),
    )
    await assertFails(
      setDoc(doc(db, 'orderPayments', UNPAID_ORDER_ID), { ...cashPayment(), changeGiven: 0 }),
    )
  })

  it('accepts exact cash with zero change', async () => {
    await seed()
    await assertSucceeds(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        cashTendered: TOTAL,
        changeGiven: 0,
      }),
    )
  })

  it('refuses a float amount, tender or change', async () => {
    await seed()
    const db = staffDb()
    await assertFails(
      setDoc(doc(db, 'orderPayments', UNPAID_ORDER_ID), { ...cashPayment(), amount: 31.9 }),
    )
    await assertFails(
      setDoc(doc(db, 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        cashTendered: 50.0001,
        changeGiven: 1810,
      }),
    )
  })

  it('refuses a cash payment with null cash figures', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        cashTendered: null,
        changeGiven: null,
      }),
    )
  })

  it('refuses an e-wallet payment that carries cash figures', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...ewalletPayment(),
        cashTendered: 5000,
        changeGiven: 1810,
      }),
    )
  })

  it('refuses a method the café does not take', async () => {
    await seed()
    const db = staffDb()
    for (const method of ['card', 'crypto', 'duitnow', 'cheque', '']) {
      await assertFails(
        setDoc(doc(db, 'orderPayments', UNPAID_ORDER_ID), {
          ...ewalletPayment(),
          method,
        }),
      )
    }
  })

  it('refuses a payment whose orderId does not match its document id', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        orderId: 'somewhere-else',
      }),
    )
  })

  it('refuses a payment for an order that does not exist', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', 'no-such-order'), {
        ...cashPayment(STAFF_UID, 'no-such-order'),
      }),
    )
  })

  it('refuses a payment with no timestamp', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        paidAt: 'this morning',
      }),
    )
  })
})

describe('payment rules: recording payment grants nothing else', () => {
  it('leaves the order itself untouchable', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), cashPayment()))

    // The point of the sidecar document: paying an order never opened a door to editing it.
    await assertFails(updateDoc(doc(staffDb(), 'orders', UNPAID_ORDER_ID), { total: 1 }))
    await assertFails(
      updateDoc(doc(staffDb(), 'orders', UNPAID_ORDER_ID), { paymentMethod: 'cash' }),
    )
    await assertFails(updateDoc(doc(adminDb(), 'orders', UNPAID_ORDER_ID), { total: 1 }))
    await assertFails(deleteDoc(doc(staffDb(), 'orders', UNPAID_ORDER_ID)))
  })

  it('does not give staff access to cost or the staff roster', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), cashPayment()))

    await assertFails(getDoc(doc(staffDb(), 'menuItemCosts', 'i1')))
    await assertFails(getDocs(collection(staffDb(), 'menuItemCostHistory')))
    await assertFails(
      setDoc(doc(staffDb(), 'staffMembers', 'mallory'), { name: 'Mallory', active: true }),
    )
  })
})

describe('payment rules: who took the money must be a real, active operator', () => {
  // The same guarantees order attribution has, applied to money. A payment that could name
  // anybody would make the audit trail decorative.

  it('accepts a named, active operator whose name matches the roster', async () => {
    await seed()
    await assertSucceeds(
      setDoc(
        doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID),
        cashPayment(STAFF_UID, UNPAID_ORDER_ID),
      ),
    )
  })

  it('accepts the signed-in account as its own operator — the shared-till form', async () => {
    await seed()
    // Always available to everybody, which is what stops an empty roster making it
    // impossible to take money, and what lets an admin settle an order having picked nobody.
    await assertSucceeds(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        paidByStaffId: STAFF_UID,
        paidByStaffName: 'Sam Staff',
      }),
    )
  })

  it('lets an admin pay as themselves without selecting an operator', async () => {
    await seed()
    await assertSucceeds(
      setDoc(doc(adminDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(ADMIN_UID),
        paidByName: 'Ada Admin',
        paidByStaffId: ADMIN_UID,
        paidByStaffName: 'Ada Admin',
      }),
    )
  })

  it('refuses the self form when the name is not the account’s display name', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        paidByStaffId: STAFF_UID,
        paidByStaffName: 'Somebody Else',
      }),
    )
  })

  it('refuses an operator who does not exist', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        paidByStaffId: 'ghost',
        paidByStaffName: 'Ghost',
      }),
    )
  })

  it('refuses a DEACTIVATED operator', async () => {
    await seed()
    // Retiring someone must stop money being recorded in their name from that moment on.
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        paidByStaffId: 'retired',
        paidByStaffName: 'Rita Retired',
      }),
    )
  })

  it('refuses a real operator under the wrong name — no spoofing a colleague', async () => {
    await seed()
    // Alice's id with Bob's name, and Bob's id with Alice's name. Neither may write.
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        paidByStaffId: 'alice',
        paidByStaffName: 'Bob',
      }),
    )
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        paidByStaffId: 'bob',
        paidByStaffName: 'Alice',
      }),
    )
  })

  it('refuses a payment with no operator at all', async () => {
    await seed()
    const db = staffDb()

    // The fields omitted entirely. Written by deleting the keys rather than setting them to
    // undefined, which the SDK rejects client-side before the rules ever see the write —
    // that would test the SDK, not the rule.
    const withoutOperator: Record<string, unknown> = { ...cashPayment() }
    delete withoutOperator.paidByStaffId
    delete withoutOperator.paidByStaffName
    await assertFails(setDoc(doc(db, 'orderPayments', UNPAID_ORDER_ID), withoutOperator))

    for (const broken of [
      { paidByStaffId: '', paidByStaffName: '' },
      { paidByStaffId: 'alice', paidByStaffName: '' },
      { paidByStaffId: null, paidByStaffName: null },
      { paidByStaffId: 'alice', paidByStaffName: 'A'.repeat(61) },
    ]) {
      await assertFails(
        setDoc(doc(db, 'orderPayments', UNPAID_ORDER_ID), { ...cashPayment(), ...broken }),
      )
    }
  })

  it('takes the CURRENT name after a rename, and refuses the stale one', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'staffMembers', 'alice'), {
        name: 'Alicia',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })

    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        paidByStaffName: 'Alice',
      }),
    )
    await assertSucceeds(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        paidByStaffName: 'Alicia',
      }),
    )
  })

  it('does not let recording a payment create or alter a staff identity', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), cashPayment()))

    // Naming an operator is not the same as being able to manage the roster.
    await assertFails(
      setDoc(doc(staffDb(), 'staffMembers', 'alice'), {
        name: 'Alice',
        active: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
  })
})

/**
 * Phase 10. A payment may carry exactly the keys recordPayment writes, and the account it
 * names must be the account that wrote it. Money is the last record where an invented field
 * or a borrowed name should be able to get in.
 */
describe('payment rules: the exact shape of a payment', () => {
  it('refuses a payment carrying a field the till does not write', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        tip: 500,
      }),
    )
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        refunded: false,
      }),
    )
  })

  it('refuses a payment that omits the cash fields instead of nulling them', async () => {
    await seed()
    // An e-wallet payment writes cashTendered and changeGiven as null rather than leaving
    // them out — validCashPayment reads both on that branch, so absent is not the same as
    // null here any more than it is for tableNumber.
    const { cashTendered: _t, changeGiven: _c, ...missing } = ewalletPayment()
    await assertFails(setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), missing))
  })

  it('refuses money recorded under somebody else’s name', async () => {
    await seed()
    // paidBy is the caller's own uid, so the existing check passes. What is being faked is
    // who the record will say took the money.
    await assertFails(
      setDoc(doc(staffDb(), 'orderPayments', UNPAID_ORDER_ID), {
        ...cashPayment(),
        paidByName: 'Ada Admin',
      }),
    )
  })
})
