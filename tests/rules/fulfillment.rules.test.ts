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

const ORDER_ID = 'order-1'
const VOIDED_ORDER_ID = 'order-voided'
const TOTAL = 3190

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ordering-system-fulfillment-rules-test',
    firestore: { rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8') },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

afterEach(async () => {
  await testEnv.clearFirestore()
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
  createdByName: 'Shared Till',
  staffId: 'alice',
  staffName: 'Alice',
  ...over,
})

/**
 * A fulfilment record naming both identities: the shared account that was signed in, and the
 * named operator who made the move.
 */
const step = (
  status: string,
  uid = STAFF_UID,
  orderId = ORDER_ID,
  operator: { id: string; name: string } = { id: 'alice', name: 'Alice' },
) => ({
  orderId,
  status,
  updatedAt: new Date(),
  updatedBy: uid,
  updatedByName: uid === ADMIN_UID ? 'Ada Admin' : 'Shared Till',
  updatedByStaffId: operator.id,
  updatedByStaffName: operator.name,
})

/** The journal entry written alongside it, in the same batch. */
const transition = (
  from: string,
  to: string,
  uid = STAFF_UID,
  orderId = ORDER_ID,
  operator: { id: string; name: string } = { id: 'alice', name: 'Alice' },
) => ({
  orderId,
  from,
  to,
  at: new Date(),
  updatedBy: uid,
  updatedByName: uid === ADMIN_UID ? 'Ada Admin' : 'Shared Till',
  updatedByStaffId: operator.id,
  updatedByStaffName: operator.name,
})

/**
 * Writes a move exactly as `fulfillment-api.ts` does: the current-state document and its
 * journal entry in ONE batch, which is what `getAfter` in the rules is there to validate.
 */
function move(
  db: ReturnType<typeof staffDb>,
  {
    from,
    to,
    uid = STAFF_UID,
    orderId = ORDER_ID,
    operator = { id: 'alice', name: 'Alice' },
  }: {
    from: string
    to: string
    uid?: string
    orderId?: string
    operator?: { id: string; name: string }
  },
) {
  const batch = writeBatch(db)
  batch.set(doc(db, 'orderFulfillment', orderId), step(to, uid, orderId, operator))
  batch.set(
    doc(collection(db, 'orderFulfillment', orderId, 'transitions')),
    transition(from, to, uid, orderId, operator),
  )
  return batch.commit()
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
    await setDoc(doc(db, 'users', STAFF_UID), {
      uid: STAFF_UID,
      email: 'staff@example.com',
      displayName: 'Shared Till',
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

    await setDoc(doc(db, 'orders', ORDER_ID), order())
    await setDoc(doc(db, 'orders', VOIDED_ORDER_ID), order({ number: 2 }))
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

/** Puts an order at a given status without going through the rules. */
async function seedAt(status: string, orderId = ORDER_ID) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'orderFulfillment', orderId), step(status))
  })
}

const staffDb = () => testEnv.authenticatedContext(STAFF_UID).firestore()
const adminDb = () => testEnv.authenticatedContext(ADMIN_UID).firestore()

describe('fulfilment rules: the forward path', () => {
  // Test 2. `pending` is the absence of the document, so the first move is a create.
  it('lets staff start preparing a newly placed order', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), step('preparing')))
  })

  // Test 3.
  it('lets staff move preparing → ready', async () => {
    await seed()
    await seedAt('preparing')
    await assertSucceeds(updateDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), step('ready')))
  })

  // Test 4.
  it('lets staff move ready → delivered', async () => {
    await seed()
    await seedAt('ready')
    await assertSucceeds(updateDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), step('delivered')))
  })

  it('walks the whole progression one step at a time', async () => {
    await seed()
    const db = staffDb()
    await assertSucceeds(setDoc(doc(db, 'orderFulfillment', ORDER_ID), step('preparing')))
    await assertSucceeds(updateDoc(doc(db, 'orderFulfillment', ORDER_ID), step('ready')))
    await assertSucceeds(updateDoc(doc(db, 'orderFulfillment', ORDER_ID), step('delivered')))

    const final = await getDoc(doc(db, 'orderFulfillment', ORDER_ID))
    expect(final.data()?.status).toBe('delivered')
  })

  it('lets an admin drive the workflow too', async () => {
    await seed()
    await assertSucceeds(
      setDoc(doc(adminDb(), 'orderFulfillment', ORDER_ID), step('preparing', ADMIN_UID)),
    )
  })

  it('lets both roles read fulfilment — the kitchen and the counter share a board', async () => {
    await seed()
    await seedAt('ready')

    await assertSucceeds(getDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID)))
    const all = await assertSucceeds(getDocs(collection(staffDb(), 'orderFulfillment')))
    expect(all.size).toBe(1)
  })
})

// Test 11.
describe('fulfilment rules: invalid transitions are rejected', () => {
  it('refuses a first move to anything but preparing', async () => {
    await seed()
    const db = staffDb()
    // An order cannot be born part-way through the workflow.
    for (const status of ['ready', 'delivered', 'pending']) {
      await assertFails(setDoc(doc(db, 'orderFulfillment', ORDER_ID), step(status)))
    }
  })

  it('refuses skipping a step', async () => {
    await seed()
    await seedAt('preparing')
    // preparing → delivered jumps over ready.
    await assertFails(updateDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), step('delivered')))
  })

  it('refuses standing still', async () => {
    await seed()
    await seedAt('ready')
    await assertFails(updateDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), step('ready')))
  })

  it('refuses STAFF moving an order backward', async () => {
    await seed()
    await seedAt('delivered')
    const db = staffDb()
    await assertFails(updateDoc(doc(db, 'orderFulfillment', ORDER_ID), step('ready')))
    await assertFails(updateDoc(doc(db, 'orderFulfillment', ORDER_ID), step('preparing')))
    await assertFails(updateDoc(doc(db, 'orderFulfillment', ORDER_ID), step('pending')))
  })

  it('refuses moving on from delivered — there is nowhere further to go', async () => {
    await seed()
    await seedAt('delivered')
    await assertFails(updateDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), step('collected')))
  })

  it('refuses a status that is not on the progression', async () => {
    await seed()
    const db = staffDb()
    for (const status of ['collected', 'cancelled', 'complete', 'paid', '']) {
      await assertFails(setDoc(doc(db, 'orderFulfillment', ORDER_ID), step(status)))
    }
  })

  it('refuses a record whose orderId does not match its document id', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), {
        ...step('preparing'),
        orderId: 'somewhere-else',
      }),
    )
  })

  it('refuses fulfilment for an order that does not exist', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderFulfillment', 'no-such-order'),
        step('preparing', STAFF_UID, 'no-such-order'),
      ),
    )
  })

  it('refuses a record with no timestamp', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), {
        ...step('preparing'),
        updatedAt: 'just now',
      }),
    )
  })
})

// Test 10.
describe('fulfilment rules: unauthorised manipulation is rejected', () => {
  it('denies an anonymous caller', async () => {
    await seed()
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(doc(db, 'orderFulfillment', ORDER_ID), step('preparing')))
    await assertFails(getDoc(doc(db, 'orderFulfillment', ORDER_ID)))
  })

  it('denies a deactivated staff account', async () => {
    await seed({ staffActive: false })
    await assertFails(setDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), step('preparing')))
    await assertFails(getDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID)))
  })

  it('denies attributing a step to somebody else', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), step('preparing', OTHER_UID)),
    )
  })

  it('denies deleting the record — how an order progressed is not erasable', async () => {
    await seed()
    await seedAt('ready')
    await assertFails(deleteDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID)))
    await assertFails(deleteDoc(doc(adminDb(), 'orderFulfillment', ORDER_ID)))
  })

  it('does not let driving fulfilment touch the order, its payment or a void', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), step('preparing')))

    // Moving an order through the kitchen is not a foot in any other door.
    await assertFails(updateDoc(doc(staffDb(), 'orders', ORDER_ID), { total: 1 }))
    await assertFails(deleteDoc(doc(staffDb(), 'orders', ORDER_ID)))
    await assertFails(getDoc(doc(staffDb(), 'menuItemCosts', 'i1')))
    await assertFails(
      setDoc(doc(staffDb(), 'orderVoids', ORDER_ID), {
        orderId: ORDER_ID,
        reason: 'nope',
        amount: TOTAL,
        voidedAt: new Date(),
        voidedBy: STAFF_UID,
        voidedByName: 'Shared Till',
        initiatedByStaffId: STAFF_UID,
        initiatedByStaffName: 'Shared Till',
      }),
    )
  })
})

// Test 9.
describe('fulfilment rules: a voided order stops', () => {
  it('refuses to start preparing a voided order', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderFulfillment', VOIDED_ORDER_ID),
        step('preparing', STAFF_UID, VOIDED_ORDER_ID),
      ),
    )
  })

  it('refuses to advance an order that is voided mid-workflow', async () => {
    await seed()
    await seedAt('preparing', VOIDED_ORDER_ID)

    // Work had started before the void; it must not continue afterwards.
    await assertFails(
      updateDoc(
        doc(staffDb(), 'orderFulfillment', VOIDED_ORDER_ID),
        step('ready', STAFF_UID, VOIDED_ORDER_ID),
      ),
    )
  })

  it('refuses it for an admin as well', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(adminDb(), 'orderFulfillment', VOIDED_ORDER_ID),
        step('preparing', ADMIN_UID, VOIDED_ORDER_ID),
      ),
    )
  })
})

describe('fulfilment rules: an admin may correct a mis-tap', () => {
  // The forward path is otherwise a one-way door; see fulfillment-api.ts.
  it('lets an admin step back exactly one place', async () => {
    await seed()
    await seedAt('delivered')
    await assertSucceeds(
      updateDoc(doc(adminDb(), 'orderFulfillment', ORDER_ID), step('ready', ADMIN_UID)),
    )
  })

  it('does not let an admin rewind further than one step', async () => {
    await seed()
    await seedAt('delivered')
    await assertFails(
      updateDoc(doc(adminDb(), 'orderFulfillment', ORDER_ID), step('preparing', ADMIN_UID)),
    )
    await assertFails(
      updateDoc(doc(adminDb(), 'orderFulfillment', ORDER_ID), step('pending', ADMIN_UID)),
    )
  })

  it('does not let an admin rewind a voided order either', async () => {
    await seed()
    await seedAt('delivered', VOIDED_ORDER_ID)
    await assertFails(
      updateDoc(
        doc(adminDb(), 'orderFulfillment', VOIDED_ORDER_ID),
        step('ready', ADMIN_UID, VOIDED_ORDER_ID),
      ),
    )
  })
})

describe('fulfilment rules: who moved it must be a real, active operator', () => {
  // The same guarantees order and payment attribution have, applied to the kitchen, and
  // enforced by the SAME validOperator function.

  it('accepts a named, active operator whose name matches the roster', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), step('preparing')))
  })

  it('accepts the signed-in account as its own operator — the shared-till form', async () => {
    await seed()
    await assertSucceeds(
      setDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        step('preparing', STAFF_UID, ORDER_ID, { id: STAFF_UID, name: 'Shared Till' }),
      ),
    )
  })

  it('lets an admin move an order with no named operator selected', async () => {
    await seed()
    await assertSucceeds(
      setDoc(
        doc(adminDb(), 'orderFulfillment', ORDER_ID),
        step('preparing', ADMIN_UID, ORDER_ID, { id: ADMIN_UID, name: 'Ada Admin' }),
      ),
    )
  })

  it('lets an admin record a named operator when one IS selected', async () => {
    await seed()
    await assertSucceeds(
      setDoc(
        doc(adminDb(), 'orderFulfillment', ORDER_ID),
        step('preparing', ADMIN_UID, ORDER_ID, { id: 'bob', name: 'Bob' }),
      ),
    )
  })

  it('refuses the self form under the wrong display name', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        step('preparing', STAFF_UID, ORDER_ID, { id: STAFF_UID, name: 'Somebody Else' }),
      ),
    )
  })

  it('refuses an operator who does not exist', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        step('preparing', STAFF_UID, ORDER_ID, { id: 'ghost', name: 'Ghost' }),
      ),
    )
  })

  it('refuses a DEACTIVATED operator', async () => {
    await seed()
    // Retiring somebody must stop work being recorded in their name from that moment on.
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        step('preparing', STAFF_UID, ORDER_ID, { id: 'retired', name: 'Rita Retired' }),
      ),
    )
  })

  it('refuses a real operator under the wrong name — no spoofing a colleague', async () => {
    await seed()
    const db = staffDb()
    await assertFails(
      setDoc(
        doc(db, 'orderFulfillment', ORDER_ID),
        step('preparing', STAFF_UID, ORDER_ID, { id: 'alice', name: 'Bob' }),
      ),
    )
    await assertFails(
      setDoc(
        doc(db, 'orderFulfillment', ORDER_ID),
        step('preparing', STAFF_UID, ORDER_ID, { id: 'bob', name: 'Alice' }),
      ),
    )
  })

  it('refuses a move with no operator at all', async () => {
    await seed()
    const db = staffDb()

    // Omitted entirely — written by deleting the keys, since the SDK rejects `undefined`
    // client-side before the rules ever see the write.
    const withoutOperator: Record<string, unknown> = { ...step('preparing') }
    delete withoutOperator.updatedByStaffId
    delete withoutOperator.updatedByStaffName
    await assertFails(setDoc(doc(db, 'orderFulfillment', ORDER_ID), withoutOperator))

    for (const broken of [
      { updatedByStaffId: '', updatedByStaffName: '' },
      { updatedByStaffId: 'alice', updatedByStaffName: '' },
      { updatedByStaffId: null, updatedByStaffName: null },
      { updatedByStaffId: 'alice', updatedByStaffName: 'A'.repeat(61) },
    ]) {
      await assertFails(
        setDoc(doc(db, 'orderFulfillment', ORDER_ID), { ...step('preparing'), ...broken }),
      )
    }
  })

  it('validates the operator on a LATER step too, not just the first', async () => {
    await seed()
    await seedAt('preparing')
    // The update path must be guarded as tightly as the create path.
    await assertFails(
      updateDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        step('ready', STAFF_UID, ORDER_ID, { id: 'ghost', name: 'Ghost' }),
      ),
    )
    await assertSucceeds(
      updateDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        step('ready', STAFF_UID, ORDER_ID, { id: 'bob', name: 'Bob' }),
      ),
    )
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
      setDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        step('preparing', STAFF_UID, ORDER_ID, { id: 'alice', name: 'Alice' }),
      ),
    )
    await assertSucceeds(
      setDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        step('preparing', STAFF_UID, ORDER_ID, { id: 'alice', name: 'Alicia' }),
      ),
    )
  })

  it('does not let moving an order create or alter a staff identity', async () => {
    await seed()
    await assertSucceeds(setDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), step('preparing')))

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

describe('fulfilment rules: the transition journal', () => {
  const ALICE = { id: 'alice', name: 'Alice' }
  const BOB = { id: 'bob', name: 'Bob' }

  it('records each step, and one operator never overwrites another', async () => {
    await seed()
    const db = staffDb()

    // Alice starts it; Bob finishes it. Both facts must survive.
    await assertSucceeds(move(db, { from: 'pending', to: 'preparing', operator: ALICE }))
    await assertSucceeds(move(db, { from: 'preparing', to: 'ready', operator: BOB }))

    const entries = await getDocs(collection(db, 'orderFulfillment', ORDER_ID, 'transitions'))
    expect(entries.size).toBe(2)

    const byStep = new Map(entries.docs.map((d) => [`${d.data().from}->${d.data().to}`, d.data()]))
    expect(byStep.get('pending->preparing')?.updatedByStaffName).toBe('Alice')
    expect(byStep.get('preparing->ready')?.updatedByStaffName).toBe('Bob')

    // The parent shows only the LAST mover, which is exactly why the journal exists.
    const current = await getDoc(doc(db, 'orderFulfillment', ORDER_ID))
    expect(current.data()?.updatedByStaffName).toBe('Bob')
    expect(current.data()?.status).toBe('ready')

    // Both entries keep the shared account alongside the person.
    for (const entry of entries.docs) {
      expect(entry.data().updatedBy).toBe(STAFF_UID)
      expect(entry.data().updatedByName).toBe('Shared Till')
    }
  })

  it('keeps the whole trail across all three forward steps', async () => {
    await seed()
    const db = staffDb()
    await assertSucceeds(move(db, { from: 'pending', to: 'preparing', operator: ALICE }))
    await assertSucceeds(move(db, { from: 'preparing', to: 'ready', operator: BOB }))
    await assertSucceeds(move(db, { from: 'ready', to: 'delivered', operator: ALICE }))

    const entries = await getDocs(collection(db, 'orderFulfillment', ORDER_ID, 'transitions'))
    expect(entries.size).toBe(3)
    expect(entries.docs.filter((d) => d.data().updatedByStaffName === 'Alice')).toHaveLength(2)
    expect(entries.docs.filter((d) => d.data().updatedByStaffName === 'Bob')).toHaveLength(1)
  })

  it('refuses a journal entry naming an operator who is not who they say', async () => {
    await seed()
    const db = staffDb()
    await assertFails(
      move(db, { from: 'pending', to: 'preparing', operator: { id: 'alice', name: 'Bob' } }),
    )
    await assertFails(
      move(db, { from: 'pending', to: 'preparing', operator: { id: 'ghost', name: 'Ghost' } }),
    )
    await assertFails(
      move(db, {
        from: 'pending',
        to: 'preparing',
        operator: { id: 'retired', name: 'Rita Retired' },
      }),
    )
  })

  it('refuses an entry whose `to` disagrees with the status actually written', async () => {
    await seed()
    const db = staffDb()
    const batch = writeBatch(db)
    batch.set(doc(db, 'orderFulfillment', ORDER_ID), step('preparing'))
    // The journal claims the order reached `ready`; the parent says `preparing`. getAfter
    // is what catches this.
    batch.set(
      doc(collection(db, 'orderFulfillment', ORDER_ID, 'transitions')),
      transition('pending', 'ready'),
    )
    await assertFails(batch.commit())
  })

  it('refuses an entry that does not move anywhere', async () => {
    await seed()
    const db = staffDb()
    const batch = writeBatch(db)
    batch.set(doc(db, 'orderFulfillment', ORDER_ID), step('preparing'))
    batch.set(
      doc(collection(db, 'orderFulfillment', ORDER_ID, 'transitions')),
      transition('preparing', 'preparing'),
    )
    await assertFails(batch.commit())
  })

  it('refuses an entry naming a status that is not on the progression', async () => {
    await seed()
    const db = staffDb()
    const batch = writeBatch(db)
    batch.set(doc(db, 'orderFulfillment', ORDER_ID), step('preparing'))
    batch.set(
      doc(collection(db, 'orderFulfillment', ORDER_ID, 'transitions')),
      transition('collected', 'preparing'),
    )
    await assertFails(batch.commit())
  })

  it('is append-only — entries cannot be edited or deleted by anyone', async () => {
    await seed()
    await assertSucceeds(move(staffDb(), { from: 'pending', to: 'preparing', operator: ALICE }))

    const entries = await getDocs(
      collection(staffDb(), 'orderFulfillment', ORDER_ID, 'transitions'),
    )
    const id = entries.docs[0]!.id

    for (const db of [staffDb(), adminDb()]) {
      await assertFails(
        updateDoc(doc(db, 'orderFulfillment', ORDER_ID, 'transitions', id), {
          updatedByStaffName: 'Bob',
        }),
      )
      await assertFails(deleteDoc(doc(db, 'orderFulfillment', ORDER_ID, 'transitions', id)))
    }
  })

  it('denies an anonymous caller reading or writing the trail', async () => {
    await seed()
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDocs(collection(anon, 'orderFulfillment', ORDER_ID, 'transitions')))
    await assertFails(move(anon, { from: 'pending', to: 'preparing', operator: ALICE }))
  })

  it('journals an admin rollback rather than quietly rewinding', async () => {
    await seed()
    await seedAt('delivered')
    await assertSucceeds(
      move(adminDb(), {
        from: 'delivered',
        to: 'ready',
        uid: ADMIN_UID,
        operator: { id: ADMIN_UID, name: 'Ada Admin' },
      }),
    )

    const entries = await getDocs(
      collection(adminDb(), 'orderFulfillment', ORDER_ID, 'transitions'),
    )
    expect(entries.size).toBe(1)
    expect(entries.docs[0]!.data().from).toBe('delivered')
    expect(entries.docs[0]!.data().to).toBe('ready')
    expect(entries.docs[0]!.data().updatedByStaffName).toBe('Ada Admin')
  })

  it('still refuses a staff rollback, journal or not', async () => {
    await seed()
    await seedAt('delivered')
    await assertFails(move(staffDb(), { from: 'delivered', to: 'ready', operator: ALICE }))
  })

  it('still refuses a batched move on a voided order', async () => {
    await seed()
    await assertFails(
      move(staffDb(), { from: 'pending', to: 'preparing', orderId: VOIDED_ORDER_ID }),
    )
  })
})

/**
 * Phase 10. Both documents a move writes carry exactly the keys fulfillment-api.ts gives
 * them, and the account named on a step is the account that made it. The journal is the
 * answer to "who did which step", so a borrowed name there is the whole point of it lost.
 */
describe('fulfilment rules: the exact shape of a move', () => {
  it('refuses a fulfilment record carrying a field the app does not write', async () => {
    await seed()
    const db = staffDb()
    const batch = writeBatch(db)
    batch.set(doc(db, 'orderFulfillment', ORDER_ID), {
      ...step('preparing'),
      priority: 'rush',
    })
    batch.set(
      doc(collection(db, 'orderFulfillment', ORDER_ID, 'transitions')),
      transition('pending', 'preparing'),
    )
    await assertFails(batch.commit())
  })

  it('refuses a journal entry carrying a field the app does not write', async () => {
    await seed()
    const db = staffDb()
    const batch = writeBatch(db)
    batch.set(doc(db, 'orderFulfillment', ORDER_ID), step('preparing'))
    batch.set(doc(collection(db, 'orderFulfillment', ORDER_ID, 'transitions')), {
      ...transition('pending', 'preparing'),
      note: 'started early',
    })
    await assertFails(batch.commit())
  })

  it('refuses a move credited to somebody else’s account', async () => {
    await seed()
    const db = staffDb()
    const batch = writeBatch(db)
    // updatedBy is the caller's own uid; only the name is borrowed.
    batch.set(doc(db, 'orderFulfillment', ORDER_ID), {
      ...step('preparing'),
      updatedByName: 'Ada Admin',
    })
    batch.set(
      doc(collection(db, 'orderFulfillment', ORDER_ID, 'transitions')),
      transition('pending', 'preparing'),
    )
    await assertFails(batch.commit())
  })
})
