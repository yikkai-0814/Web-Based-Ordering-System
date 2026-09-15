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
  serverTimestamp,
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
/**
 * The finish a document arriving at `status` should carry, for the many writes that are
 * built by hand rather than read back first.
 *
 * A preserved value uses the constant `seedAt` writes, so any test that seeds a document and
 * then steps it forward lines up without a read. Sequences that CREATE through the rules —
 * where the stored value is a server timestamp nobody can predict — use `stepAt` instead.
 */
function arrivingAt(status: string): Preparation {
  if (status === 'ready') return { readyAt: serverTimestamp(), deliveredAt: null }
  if (status === 'delivered') {
    return { readyAt: SEEDED_READY_AT, deliveredAt: serverTimestamp() }
  }
  return { readyAt: null, deliveredAt: null }
}

const step = (
  status: string,
  uid = STAFF_UID,
  orderId = ORDER_ID,
  operator: { id: string; name: string } = { id: 'alice', name: 'Alice' },
  prep: Preparation = arrivingAt(status),
) => ({
  orderId,
  status,
  updatedAt: new Date(),
  updatedBy: uid,
  updatedByName: uid === ADMIN_UID ? 'Ada Admin' : 'Shared Till',
  updatedByStaffId: operator.id,
  updatedByStaffName: operator.name,
  ...prep,
})

/**
 * Preparation timing, stated here independently of the app's own copy in fulfillment.ts.
 *
 * These suites exist to say what the SERVER accepts. Importing the app's table would make
 * the two agree by construction, which is exactly the drift this file is meant to catch.
 *
 * Only the FINISH lives on this document. The clock's start is the order's own `createdAt`,
 * which nothing here can write or move, so there is no start field to check.
 *
 * `serverTimestamp()` is the only value the rules will take for a finish that must be "now":
 * they compare against `request.time`, so a client's own `new Date()` is refused however
 * plausible it looks. That is the forgery defence, and it is asserted directly below.
 */
interface Preparation {
  readyAt: unknown
  deliveredAt: unknown
}

/** A concrete finish for a document seeded past `ready`, with rules disabled. */
const SEEDED_READY_AT = new Date('2026-09-11T10:05:00.000Z')

/** A concrete handover for a document seeded at `delivered`, with rules disabled. */
const SEEDED_DELIVERED_AT = new Date('2026-09-11T10:07:00.000Z')

/** What a document seeded at `status` carries, so an update can be checked against it. */
function seededPrior(status: string): Preparation {
  if (status === 'delivered') {
    return { readyAt: SEEDED_READY_AT, deliveredAt: SEEDED_DELIVERED_AT }
  }
  if (status === 'ready') return { readyAt: SEEDED_READY_AT, deliveredAt: null }
  return { readyAt: null, deliveredAt: null }
}

/** The timestamps the server will accept for a step out of `from` into `to`. */
function preparationFor(from: string, to: string, prior: Preparation): Preparation {
  // The handover is the only thing that stops the clock, and it has no "unchanged" case:
  // an order is delivered or it is not.
  const deliveredAt = to === 'delivered' ? serverTimestamp() : null
  if (to === 'ready' && from === 'preparing') {
    return { readyAt: serverTimestamp(), deliveredAt }
  }
  if (to === 'ready' || to === 'delivered') return { readyAt: prior.readyAt, deliveredAt }
  return { readyAt: null, deliveredAt }
}

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
async function move(
  db: ReturnType<typeof staffDb>,
  {
    from,
    to,
    uid = STAFF_UID,
    orderId = ORDER_ID,
    operator = { id: 'alice', name: 'Alice' },
    prep,
  }: {
    from: string
    to: string
    uid?: string
    orderId?: string
    operator?: { id: string; name: string }
    /** Override, to send something the server should refuse. */
    prep?: Preparation
  },
) {
  // The app always has the current record to hand, from the listener that rendered the
  // button; this reads it for the same reason. A step that must preserve a timestamp has to
  // resend the one actually stored — the document is written whole.
  const existing = await getDoc(doc(db, 'orderFulfillment', orderId))
  const prior: Preparation = existing.exists()
    ? {
        readyAt: existing.get('readyAt') ?? null,
        deliveredAt: existing.get('deliveredAt') ?? null,
      }
    : { readyAt: null, deliveredAt: null }

  const batch = writeBatch(db)
  batch.set(
    doc(db, 'orderFulfillment', orderId),
    step(to, uid, orderId, operator, prep ?? preparationFor(from, to, prior)),
  )
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
    await setDoc(
      doc(context.firestore(), 'orderFulfillment', orderId),
      step(status, STAFF_UID, orderId, { id: 'alice', name: 'Alice' }, seededPrior(status)),
    )
  })
}

/**
 * A document as it was written BEFORE a finish was recorded: the key is not present.
 *
 * Used to prove an ordinary step on an old order is still accepted. The rules read the
 * previous values with get(..., null) precisely so this case does not error the rule.
 */
async function seedLegacyAt(status: string, orderId = ORDER_ID) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const legacy: Record<string, unknown> = step(status)
    delete legacy.readyAt
    delete legacy.deliveredAt
    await setDoc(doc(context.firestore(), 'orderFulfillment', orderId), legacy)
  })
}

/**
 * `step()` built against what the document currently holds.
 *
 * A step that preserves a timestamp has to resend the one actually stored — the parent is
 * written whole — so the prior values are read first, exactly as the app has them from the
 * listener that rendered the button. Tests that mean to send something the server should
 * refuse pass `prep` explicitly.
 */
async function stepAt(
  db: ReturnType<typeof staffDb>,
  status: string,
  uid = STAFF_UID,
  orderId = ORDER_ID,
  operator: { id: string; name: string } = { id: 'alice', name: 'Alice' },
  prep?: Preparation,
) {
  const existing = await getDoc(doc(db, 'orderFulfillment', orderId))
  const from = existing.exists() ? (existing.get('status') as string) : 'pending'
  const prior: Preparation = existing.exists()
    ? {
        readyAt: existing.get('readyAt') ?? null,
        deliveredAt: existing.get('deliveredAt') ?? null,
      }
    : { readyAt: null, deliveredAt: null }

  return step(status, uid, orderId, operator, prep ?? preparationFor(from, status, prior))
}

const staffDb = () => testEnv.authenticatedContext(STAFF_UID).firestore()
const adminDb = () => testEnv.authenticatedContext(ADMIN_UID).firestore()

describe('fulfilment rules: the forward path', () => {
  // Test 2. `pending` is the absence of the document, so the first move is a create.
  it('lets staff start preparing a newly placed order', async () => {
    await seed()
    await assertSucceeds(
      setDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(staffDb(), 'preparing', STAFF_UID, ORDER_ID),
      ),
    )
  })

  // Test 3.
  it('lets staff move preparing → ready', async () => {
    await seed()
    await seedAt('preparing')
    await assertSucceeds(
      updateDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(staffDb(), 'ready', STAFF_UID, ORDER_ID),
      ),
    )
  })

  // Test 4.
  it('lets staff move ready → delivered', async () => {
    await seed()
    await seedAt('ready')
    await assertSucceeds(
      updateDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(staffDb(), 'delivered', STAFF_UID, ORDER_ID),
      ),
    )
  })

  it('walks the whole progression one step at a time', async () => {
    await seed()
    const db = staffDb()
    await assertSucceeds(
      setDoc(
        doc(db, 'orderFulfillment', ORDER_ID),
        // Built without reading first: these callers may not read either, and the refusal
        // would then land outside assertFails.
        step('preparing', STAFF_UID, ORDER_ID),
      ),
    )
    await assertSucceeds(
      updateDoc(
        doc(db, 'orderFulfillment', ORDER_ID),
        await stepAt(db, 'ready', STAFF_UID, ORDER_ID),
      ),
    )
    await assertSucceeds(
      updateDoc(
        doc(db, 'orderFulfillment', ORDER_ID),
        await stepAt(db, 'delivered', STAFF_UID, ORDER_ID),
      ),
    )

    const final = await getDoc(doc(db, 'orderFulfillment', ORDER_ID))
    expect(final.data()?.status).toBe('delivered')
  })

  /**
   * 7. The admin half of the permission model, stated at the first step.
   *
   * An admin is a back-office account — menu, costing, reports, the roster — used mostly
   * outside operating hours. The kitchen workflow is the counter's, so an admin cannot even
   * start an order preparing, let alone finish or hand one over. The rule says isStaff()
   * rather than "not an admin" precisely so this is a decision about who owns the workflow
   * rather than a hole shaped like one role.
   */
  it('refuses to let an ADMIN start the workflow', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(adminDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(adminDb(), 'preparing', ADMIN_UID, ORDER_ID),
      ),
    )
  })

  it('7. refuses an ADMIN every forward step, not just the first', async () => {
    await seed()

    for (const [from, to] of [
      ['preparing', 'ready'],
      ['ready', 'delivered'],
    ] as const) {
      await seedAt(from)
      await assertFails(
        updateDoc(
          doc(adminDb(), 'orderFulfillment', ORDER_ID),
          await stepAt(adminDb(), to, ADMIN_UID, ORDER_ID),
        ),
      )
      // The refusal changed nothing: the order is where the kitchen left it.
      const after = await getDoc(doc(adminDb(), 'orderFulfillment', ORDER_ID))
      expect(after.data()?.status).toBe(from)
    }
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
      await assertFails(
        setDoc(
          doc(db, 'orderFulfillment', ORDER_ID),
          await stepAt(db, status, STAFF_UID, ORDER_ID),
        ),
      )
    }
  })

  it('refuses skipping a step', async () => {
    await seed()
    await seedAt('preparing')
    // preparing → delivered jumps over ready.
    await assertFails(
      updateDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(staffDb(), 'delivered', STAFF_UID, ORDER_ID),
      ),
    )
  })

  it('refuses standing still', async () => {
    await seed()
    await seedAt('ready')
    await assertFails(
      updateDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(staffDb(), 'ready', STAFF_UID, ORDER_ID),
      ),
    )
  })

  it('refuses STAFF moving an order backward', async () => {
    await seed()
    await seedAt('delivered')
    const db = staffDb()
    await assertFails(
      updateDoc(
        doc(db, 'orderFulfillment', ORDER_ID),
        await stepAt(db, 'ready', STAFF_UID, ORDER_ID),
      ),
    )
    await assertFails(
      updateDoc(
        doc(db, 'orderFulfillment', ORDER_ID),
        // Built without reading first: these callers may not read either, and the refusal
        // would then land outside assertFails.
        step('preparing', STAFF_UID, ORDER_ID),
      ),
    )
    await assertFails(
      updateDoc(
        doc(db, 'orderFulfillment', ORDER_ID),
        await stepAt(db, 'pending', STAFF_UID, ORDER_ID),
      ),
    )
  })

  it('refuses moving on from delivered — there is nowhere further to go', async () => {
    await seed()
    await seedAt('delivered')
    await assertFails(
      updateDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(staffDb(), 'collected', STAFF_UID, ORDER_ID),
      ),
    )
  })

  it('refuses a status that is not on the progression', async () => {
    await seed()
    const db = staffDb()
    for (const status of ['collected', 'cancelled', 'complete', 'paid', '']) {
      await assertFails(
        setDoc(
          doc(db, 'orderFulfillment', ORDER_ID),
          await stepAt(db, status, STAFF_UID, ORDER_ID),
        ),
      )
    }
  })

  it('refuses a record whose orderId does not match its document id', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), {
        ...(await stepAt(staffDb(), 'preparing')),
        orderId: 'somewhere-else',
      }),
    )
  })

  it('refuses fulfilment for an order that does not exist', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderFulfillment', 'no-such-order'),
        await stepAt(staffDb(), 'preparing', STAFF_UID, 'no-such-order'),
      ),
    )
  })

  it('refuses a record with no timestamp', async () => {
    await seed()
    await assertFails(
      setDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID), {
        ...(await stepAt(staffDb(), 'preparing')),
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
    await assertFails(
      setDoc(
        doc(db, 'orderFulfillment', ORDER_ID),
        // Built without reading first: these callers may not read either, and the refusal
        // would then land outside assertFails.
        step('preparing', STAFF_UID, ORDER_ID),
      ),
    )
    await assertFails(getDoc(doc(db, 'orderFulfillment', ORDER_ID)))
  })

  it('denies a deactivated staff account', async () => {
    await seed({ staffActive: false })
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        // Built without reading first: a deactivated account may not read either, and the
        // refusal would then land outside assertFails.
        step('preparing', STAFF_UID, ORDER_ID),
      ),
    )
    await assertFails(getDoc(doc(staffDb(), 'orderFulfillment', ORDER_ID)))
  })

  it('denies attributing a step to somebody else', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(staffDb(), 'preparing', OTHER_UID, ORDER_ID),
      ),
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
    await assertSucceeds(
      setDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(staffDb(), 'preparing', STAFF_UID, ORDER_ID),
      ),
    )

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
        await stepAt(staffDb(), 'preparing', STAFF_UID, VOIDED_ORDER_ID),
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
        await stepAt(staffDb(), 'ready', STAFF_UID, VOIDED_ORDER_ID),
      ),
    )
  })

  it('refuses it for an admin as well', async () => {
    await seed()
    await assertFails(
      setDoc(
        doc(adminDb(), 'orderFulfillment', VOIDED_ORDER_ID),
        await stepAt(adminDb(), 'preparing', ADMIN_UID, VOIDED_ORDER_ID),
      ),
    )
  })
})

/**
 * 7, 8. An admin corrects nothing here.
 *
 * The backward steps are the counter's two, and `delivered → ready` is nobody's. That leaves
 * an admin with no fulfilment write at all: not forward, not back, not on a delivered order,
 * not on a voided one. What an admin still has for a sale that went wrong is the VOID — a
 * counter-entry carrying a reason and their own authorisation — which is a different
 * document, a different rule, and untouched by any of this.
 */
describe('fulfilment rules: an admin may not correct anything', () => {
  it('8. refuses an admin reopening a delivered order', async () => {
    await seed()
    await seedAt('delivered')
    await assertFails(
      updateDoc(
        doc(adminDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(adminDb(), 'ready', ADMIN_UID, ORDER_ID),
      ),
    )

    // Still delivered. A refused write leaves the record exactly as it was.
    const after = await getDoc(doc(adminDb(), 'orderFulfillment', ORDER_ID))
    expect(after.data()?.status).toBe('delivered')
  })

  it('refuses an admin the two steps the KITCHEN owns, which are staff-only', async () => {
    await seed()

    await seedAt('preparing')
    await assertFails(
      updateDoc(
        doc(adminDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(adminDb(), 'pending', ADMIN_UID, ORDER_ID),
      ),
    )

    await seedAt('ready')
    await assertFails(
      updateDoc(
        doc(adminDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(adminDb(), 'preparing', ADMIN_UID, ORDER_ID),
      ),
    )
  })

  it('does not let an admin rewind further than one step either', async () => {
    await seed()
    await seedAt('delivered')
    await assertFails(
      updateDoc(
        doc(adminDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(adminDb(), 'preparing', ADMIN_UID, ORDER_ID),
      ),
    )
    await assertFails(
      updateDoc(
        doc(adminDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(adminDb(), 'pending', ADMIN_UID, ORDER_ID),
      ),
    )
  })

  it('does not let an admin rewind a voided order either', async () => {
    await seed()
    await seedAt('delivered', VOIDED_ORDER_ID)
    await assertFails(
      updateDoc(
        doc(adminDb(), 'orderFulfillment', VOIDED_ORDER_ID),
        await stepAt(adminDb(), 'ready', ADMIN_UID, VOIDED_ORDER_ID),
      ),
    )
  })

  /**
   * 6. And the step is not staff's either, so it belongs to nobody.
   *
   * Asserted here, beside the admin refusal, because that adjacency IS the property: the two
   * together say there is no role for which `delivered → ready` is permitted, which a pair
   * of refusals filed in separate describes would only imply.
   */
  it('6. refuses STAFF reopening a delivered order, so no role can', async () => {
    await seed()
    await seedAt('delivered')
    await assertFails(
      updateDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(staffDb(), 'ready', STAFF_UID, ORDER_ID),
      ),
    )
  })
})

/**
 * 9. Reading is the one thing an admin keeps.
 *
 * Losing the write must not cost them the view: the dashboard, the reports and the receipt
 * all read where an order stands, and an admin answering a question about a sale needs to
 * see it. `allow read: if isActive()` is deliberately unchanged.
 */
describe('fulfilment rules: an admin still reads orders normally', () => {
  it('9. reads a fulfilment record, and the whole collection', async () => {
    await seed()
    await seedAt('ready')

    const one = await assertSucceeds(getDoc(doc(adminDb(), 'orderFulfillment', ORDER_ID)))
    expect(one.data()?.status).toBe('ready')

    const all = await assertSucceeds(getDocs(collection(adminDb(), 'orderFulfillment')))
    expect(all.size).toBe(1)
  })

  it('9. reads the transition journal — who did which step', async () => {
    await seed()
    await assertSucceeds(move(staffDb(), { from: 'pending', to: 'preparing' }))

    const entries = await assertSucceeds(
      getDocs(collection(adminDb(), 'orderFulfillment', ORDER_ID, 'transitions')),
    )
    expect(entries.size).toBe(1)
    expect(entries.docs[0]!.data().to).toBe('preparing')
  })

  it('9. reads the order and its payment, which this change never touched', async () => {
    await seed()
    await assertSucceeds(getDoc(doc(adminDb(), 'orders', ORDER_ID)))
    await assertSucceeds(getDoc(doc(adminDb(), 'orderVoids', VOIDED_ORDER_ID)))
  })
})

describe('fulfilment rules: who moved it must be a real, active operator', () => {
  // The same guarantees order and payment attribution have, applied to the kitchen, and
  // enforced by the SAME validOperator function.

  it('accepts a named, active operator whose name matches the roster', async () => {
    await seed()
    await assertSucceeds(
      setDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(staffDb(), 'preparing', STAFF_UID, ORDER_ID),
      ),
    )
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

  it('refuses the self form for an ADMIN, however well-formed the identity is', async () => {
    // The operator is real, active and correctly named — and it still fails, because the
    // account making the write is not staff. Identity was never the thing being withheld.
    await seed()
    await assertFails(
      setDoc(
        doc(adminDb(), 'orderFulfillment', ORDER_ID),
        step('preparing', ADMIN_UID, ORDER_ID, { id: ADMIN_UID, name: 'Ada Admin' }),
      ),
    )
  })

  it('refuses an ADMIN naming a rostered operator, too', async () => {
    await seed()
    await assertFails(
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
    await assertSucceeds(
      setDoc(
        doc(staffDb(), 'orderFulfillment', ORDER_ID),
        await stepAt(staffDb(), 'preparing', STAFF_UID, ORDER_ID),
      ),
    )

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

  it('journals a staff rollback rather than quietly rewinding', async () => {
    await seed()
    await seedAt('ready')
    await assertSucceeds(move(staffDb(), { from: 'ready', to: 'preparing', operator: ALICE }))

    const entries = await getDocs(
      collection(staffDb(), 'orderFulfillment', ORDER_ID, 'transitions'),
    )
    expect(entries.size).toBe(1)
    expect(entries.docs[0]!.data().from).toBe('ready')
    expect(entries.docs[0]!.data().to).toBe('preparing')
    expect(entries.docs[0]!.data().updatedByStaffName).toBe('Alice')
  })

  it('6. still refuses a batched reopen of a delivered order, journal or not', async () => {
    await seed()
    await seedAt('delivered')
    await assertFails(move(staffDb(), { from: 'delivered', to: 'ready', operator: ALICE }))
  })

  it('7. refuses an admin appending to the trail, even for a step it could not make', async () => {
    // The journal entry and the parent land in one batch, so they share a role gate. Without
    // isStaff() on the subcollection an admin could still write the trail on its own — an
    // entry describing a move they are not permitted to perform.
    await seed()
    await assertFails(
      move(adminDb(), {
        from: 'pending',
        to: 'preparing',
        uid: ADMIN_UID,
        operator: { id: ADMIN_UID, name: 'Ada Admin' },
      }),
    )

    const entries = await getDocs(
      collection(staffDb(), 'orderFulfillment', ORDER_ID, 'transitions'),
    )
    expect(entries.size).toBe(0)
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

/**
 * Preparation timing.
 *
 * Only the FINISH is recorded here. The clock starts from the order's own immutable
 * `createdAt`, so there is no start field on this document for a client to forge, move, or
 * lose — and payment, which lives in a different document entirely, cannot reach it.
 *
 * The finish IS sent by the client, so every value below is checked against `request.time`.
 * A till cannot backdate a finish to flatter its numbers, claim one for an order it never
 * completed, or quietly drop one it has already been credited with.
 */
describe('fulfilment rules: preparation timing', () => {
  // Every backward step below is the counter's own, so it is taken as the counter.
  const ALICE = { id: 'alice', name: 'Alice' }

  async function readFulfillment(db: ReturnType<typeof staffDb>, orderId = ORDER_ID) {
    return getDoc(doc(db, 'orderFulfillment', orderId))
  }

  it('records no finish when preparation starts', async () => {
    await seed()
    const db = staffDb()
    await assertSucceeds(move(db, { from: 'pending', to: 'preparing' }))

    expect((await readFulfillment(db)).get('readyAt')).toBeNull()
  })

  it('stamps the finish at ready', async () => {
    await seed()
    await seedAt('preparing')
    const db = staffDb()
    await assertSucceeds(move(db, { from: 'preparing', to: 'ready' }))

    expect((await readFulfillment(db)).get('readyAt')).not.toBeNull()
  })

  it('keeps the finish when the order is delivered, so the duration outlives the handover', async () => {
    await seed()
    await seedAt('ready')
    const db = staffDb()
    await assertSucceeds(move(db, { from: 'ready', to: 'delivered' }))

    expect((await readFulfillment(db)).get('readyAt').toDate()).toEqual(SEEDED_READY_AT)
  })

  it('11. leaves both stamps alone when a reopen is refused, for either role', async () => {
    await seed()
    await seedAt('delivered')

    await assertFails(move(staffDb(), { from: 'delivered', to: 'ready', operator: ALICE }))
    await assertFails(
      move(adminDb(), {
        from: 'delivered',
        to: 'ready',
        uid: ADMIN_UID,
        operator: { id: ADMIN_UID, name: 'Ada Admin' },
      }),
    )

    // Refused writes change nothing. The finish is still the finish, and — the one that
    // matters for the timer — the handover is still recorded, so the clock stays stopped.
    const record = await readFulfillment(staffDb())
    expect(record.get('status')).toBe('delivered')
    expect(record.get('readyAt').toDate()).toEqual(SEEDED_READY_AT)
    expect(record.get('deliveredAt').toDate()).toEqual(SEEDED_DELIVERED_AT)
  })

  it('11. clears the finish when ready is corrected back to preparing', async () => {
    await seed()
    await seedAt('ready')
    const db = staffDb()
    await assertSucceeds(move(db, { from: 'ready', to: 'preparing', operator: ALICE }))

    // The order is being worked on again, so it must stop claiming to be done. The clock
    // resumes from the order's creation, which nothing here can touch.
    expect((await readFulfillment(db)).get('readyAt')).toBeNull()
  })

  it('11. clears it when the order is corrected all the way back to pending', async () => {
    await seed()
    await seedAt('preparing')
    const db = staffDb()
    await assertSucceeds(move(db, { from: 'preparing', to: 'pending', operator: ALICE }))

    expect((await readFulfillment(db)).get('readyAt')).toBeNull()
  })

  it('refuses to keep a finish on the way back into the kitchen', async () => {
    await seed()
    await seedAt('ready')
    await assertFails(
      move(staffDb(), {
        from: 'ready',
        to: 'preparing',
        operator: ALICE,
        prep: { readyAt: SEEDED_READY_AT, deliveredAt: null },
      }),
    )
  })

  // ---- Forgery ------------------------------------------------------------

  it('refuses a client-chosen finish, however plausible it looks', async () => {
    await seed()
    await seedAt('preparing')
    await assertFails(
      move(staffDb(), {
        from: 'preparing',
        to: 'ready',
        prep: { readyAt: new Date(), deliveredAt: null },
      }),
    )
  })

  it('refuses a backdated finish, which would shrink a duration', async () => {
    await seed()
    await seedAt('preparing')
    await assertFails(
      move(staffDb(), {
        from: 'preparing',
        to: 'ready',
        prep: { readyAt: new Date('2020-01-01T00:00:00.000Z'), deliveredAt: null },
      }),
    )
  })

  it('refuses claiming a finish while merely starting preparation', async () => {
    await seed()
    await assertFails(
      move(staffDb(), {
        from: 'pending',
        to: 'preparing',
        prep: { readyAt: serverTimestamp(), deliveredAt: null },
      }),
    )
  })

  it('refuses dropping a recorded finish on the way to delivered', async () => {
    await seed()
    await seedAt('ready')
    await assertFails(
      move(staffDb(), {
        from: 'ready',
        to: 'delivered',
        prep: { readyAt: null, deliveredAt: serverTimestamp() },
      }),
    )
  })

  it('refuses rewriting a recorded finish on the way to delivered', async () => {
    await seed()
    await seedAt('ready')
    await assertFails(
      move(staffDb(), {
        from: 'ready',
        to: 'delivered',
        prep: { readyAt: new Date('2026-09-11T10:04:00.000Z'), deliveredAt: serverTimestamp() },
      }),
    )
  })

  // ---- How the app actually writes it -------------------------------------

  it('accepts a merged step that says nothing about the finish at all', async () => {
    await seed()
    await seedAt('ready')
    const db = staffDb()

    // This is the app's own shape: a step that must preserve readyAt omits the field rather
    // than reading it back and resending it, which under an optimistic UI could resend the
    // unresolved local null. An unwritten field is unchanged by definition.
    const batch = writeBatch(db)
    const { readyAt: _omitted, ...withoutFinish } = step('delivered')
    batch.set(doc(db, 'orderFulfillment', ORDER_ID), withoutFinish, { merge: true })
    batch.set(
      doc(collection(db, 'orderFulfillment', ORDER_ID, 'transitions')),
      transition('ready', 'delivered'),
    )
    await assertSucceeds(batch.commit())

    const record = await getDoc(doc(db, 'orderFulfillment', ORDER_ID))
    expect(record.get('status')).toBe('delivered')
    expect(record.get('readyAt').toDate()).toEqual(SEEDED_READY_AT)
  })

  // ---- Records written before this feature existed ------------------------

  it('still lets an ordinary step move a legacy record with no finish field', async () => {
    await seed()
    await seedLegacyAt('preparing')
    const db = staffDb()

    // The rules read the previous value behind an `in` guard precisely so this works: a bare
    // field access on a document without the key would error and deny the step.
    await assertSucceeds(move(db, { from: 'preparing', to: 'ready' }))
    expect((await readFulfillment(db)).get('readyAt')).not.toBeNull()
  })

  it('lets a legacy record be corrected backward too', async () => {
    await seed()
    await seedLegacyAt('ready')
    await assertSucceeds(move(staffDb(), { from: 'ready', to: 'preparing', operator: ALICE }))
  })

  it('tolerates a stale preparingAt left behind by an earlier version', async () => {
    await seed()
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'orderFulfillment', ORDER_ID), {
        ...step('preparing'),
        // Written by a version that recorded a start here. Nothing reads it any more, but a
        // merged update still carries the key, so the field list must not reject it.
        preparingAt: new Date('2026-09-11T10:00:00.000Z'),
      })
    })

    await assertSucceeds(move(staffDb(), { from: 'preparing', to: 'ready' }))
  })
})

/**
 * The handover, which is the one moment that stops the clock.
 *
 * `deliveredAt` is the field the elapsed duration is computed from, so the server is the
 * only thing allowed to decide it. Every value below is checked against `request.time`.
 */
describe('fulfilment rules: the delivery stamp', () => {
  const ALICE = { id: 'alice', name: 'Alice' }

  async function readFulfillment(db: ReturnType<typeof staffDb>, orderId = ORDER_ID) {
    return getDoc(doc(db, 'orderFulfillment', orderId))
  }

  it('is empty on every step short of delivery', async () => {
    await seed()
    const db = staffDb()

    await assertSucceeds(move(db, { from: 'pending', to: 'preparing' }))
    expect((await readFulfillment(db)).get('deliveredAt')).toBeNull()

    await assertSucceeds(move(db, { from: 'preparing', to: 'ready' }))
    // Ready is NOT the end of the wait: the customer still does not have the order.
    expect((await readFulfillment(db)).get('deliveredAt')).toBeNull()
    expect((await readFulfillment(db)).get('readyAt')).not.toBeNull()
  })

  it('is stamped when the order is handed over', async () => {
    await seed()
    await seedAt('ready')
    const db = staffDb()
    await assertSucceeds(move(db, { from: 'ready', to: 'delivered' }))

    const record = await readFulfillment(db)
    expect(record.get('deliveredAt')).not.toBeNull()
    // The kitchen's own finish is untouched by the handover.
    expect(record.get('readyAt').toDate()).toEqual(SEEDED_READY_AT)
  })

  it('6, 11. survives, because no role can step back out of delivered', async () => {
    await seed()
    await seedAt('delivered')

    await assertFails(move(staffDb(), { from: 'delivered', to: 'ready', operator: ALICE }))
    await assertFails(
      move(adminDb(), {
        from: 'delivered',
        to: 'ready',
        uid: ADMIN_UID,
        operator: { id: ADMIN_UID, name: 'Ada Admin' },
      }),
    )

    // The clock stopped at the handover and stays stopped: the one write that used to clear
    // this stamp is no longer reachable by anybody.
    expect((await readFulfillment(staffDb())).get('deliveredAt').toDate()).toEqual(
      SEEDED_DELIVERED_AT,
    )
  })

  it('refuses a client-chosen handover time', async () => {
    await seed()
    await seedAt('ready')
    await assertFails(
      move(staffDb(), {
        from: 'ready',
        to: 'delivered',
        prep: { readyAt: SEEDED_READY_AT, deliveredAt: new Date() },
      }),
    )
  })

  it('refuses a backdated handover, which would shrink the wait', async () => {
    await seed()
    await seedAt('ready')
    await assertFails(
      move(staffDb(), {
        from: 'ready',
        to: 'delivered',
        prep: { readyAt: SEEDED_READY_AT, deliveredAt: new Date('2020-01-01T00:00:00.000Z') },
      }),
    )
  })

  it('refuses delivering without stamping the handover at all', async () => {
    await seed()
    await seedAt('ready')
    await assertFails(
      move(staffDb(), {
        from: 'ready',
        to: 'delivered',
        prep: { readyAt: SEEDED_READY_AT, deliveredAt: null },
      }),
    )
  })

  it('refuses claiming a handover on an order that is only ready', async () => {
    await seed()
    await seedAt('preparing')
    await assertFails(
      move(staffDb(), {
        from: 'preparing',
        to: 'ready',
        prep: { readyAt: serverTimestamp(), deliveredAt: serverTimestamp() },
      }),
    )
  })

  it('refuses keeping a stale handover when stepping back out of delivered', async () => {
    // Refused twice over: the transition belongs to no role, and the stamp it carries is one
    // the server would not accept anyway. Kept as the second guard — if the step were ever
    // reopened, the timestamp half of the rule is still asserted here.
    await seed()
    await seedAt('delivered')
    await assertFails(
      move(staffDb(), {
        from: 'delivered',
        to: 'ready',
        operator: ALICE,
        prep: { readyAt: SEEDED_READY_AT, deliveredAt: SEEDED_DELIVERED_AT },
      }),
    )
  })

  it('still moves a legacy record that has neither timestamp', async () => {
    await seed()
    await seedLegacyAt('ready')
    const db = staffDb()

    await assertSucceeds(move(db, { from: 'ready', to: 'delivered' }))
    expect((await readFulfillment(db)).get('deliveredAt')).not.toBeNull()
  })
})
