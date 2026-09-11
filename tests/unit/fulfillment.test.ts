import { describe, expect, it } from 'vitest'

import {
  canAdvanceFulfillment,
  FINAL_FULFILLMENT,
  FULFILLMENT_ACTIONS,
  FULFILLMENT_LABELS,
  FULFILLMENT_STATUSES,
  indexFulfillmentsByOrderId,
  INITIAL_FULFILLMENT,
  isBackwardStep,
  isCompleted,
  isForwardStep,
  isFulfillmentStatus,
  nextFulfillment,
  overallStatusOf,
  previousFulfillment,
  resolveFulfillmentState,
  type FulfillmentStatus,
} from '@/features/pos/fulfillment'
import { resolvePaymentState, type PaymentState } from '@/features/pos/payments'
import {
  fulfillmentOperatorNameOf,
  parseFulfillmentTransition,
  parseOrderFulfillment,
} from '@/features/pos/types'

/** An order placed under the current flow: no inline payment, so it starts at pending. */
const placedOrder = { paymentMethod: null } as const
/** An order rung up before either workflow existed — paid and handed over in one motion. */
const legacyOrder = { paymentMethod: 'cash' } as const

const PAID: PaymentState = resolvePaymentState(
  { paymentMethod: null, cashTendered: null, changeGiven: null },
  { method: 'cash', cashTendered: 2000, changeGiven: 450 },
)
const UNPAID: PaymentState = resolvePaymentState(
  { paymentMethod: null, cashTendered: null, changeGiven: null },
  null,
)

const overall = (fulfillment: FulfillmentStatus, payment: PaymentState, voided = false) =>
  overallStatusOf({ fulfillment, payment, voided })

describe('the fulfilment progression', () => {
  it('runs pending → preparing → ready → delivered, in that order', () => {
    expect(FULFILLMENT_STATUSES).toEqual(['pending', 'preparing', 'ready', 'delivered'])
    expect(INITIAL_FULFILLMENT).toBe('pending')
    expect(FINAL_FULFILLMENT).toBe('delivered')
  })

  it('steps forward one at a time and stops at the end', () => {
    expect(nextFulfillment('pending')).toBe('preparing')
    expect(nextFulfillment('preparing')).toBe('ready')
    expect(nextFulfillment('ready')).toBe('delivered')
    expect(nextFulfillment('delivered')).toBeNull()
  })

  it('steps backward one at a time and stops at the start', () => {
    expect(previousFulfillment('delivered')).toBe('ready')
    expect(previousFulfillment('ready')).toBe('preparing')
    expect(previousFulfillment('preparing')).toBe('pending')
    expect(previousFulfillment('pending')).toBeNull()
  })

  it('accepts only a single step forward', () => {
    expect(isForwardStep('pending', 'preparing')).toBe(true)
    expect(isForwardStep('preparing', 'ready')).toBe(true)
    expect(isForwardStep('ready', 'delivered')).toBe(true)

    // Skipping ahead is refused — see the note in fulfillment.ts.
    expect(isForwardStep('pending', 'ready')).toBe(false)
    expect(isForwardStep('pending', 'delivered')).toBe(false)
    expect(isForwardStep('preparing', 'delivered')).toBe(false)
    // Backward is not forward.
    expect(isForwardStep('delivered', 'ready')).toBe(false)
    // Nor is standing still.
    expect(isForwardStep('ready', 'ready')).toBe(false)
  })

  it('recognises a single step backward, and nothing else', () => {
    expect(isBackwardStep('delivered', 'ready')).toBe(true)
    expect(isBackwardStep('preparing', 'pending')).toBe(true)
    expect(isBackwardStep('delivered', 'pending')).toBe(false)
    expect(isBackwardStep('pending', 'preparing')).toBe(false)
    expect(isBackwardStep('ready', 'ready')).toBe(false)
  })

  it('labels every status and offers an action for all but the last', () => {
    for (const status of FULFILLMENT_STATUSES) {
      expect(FULFILLMENT_LABELS[status]).toBeTruthy()
    }
    expect(FULFILLMENT_ACTIONS.pending).toBe('Start preparing')
    expect(FULFILLMENT_ACTIONS.ready).toBe('Mark delivered')
    // Nothing follows delivered, so there is no button to offer.
    expect(FULFILLMENT_ACTIONS.delivered).toBeNull()
  })

  it('recognises only the four real statuses', () => {
    expect(isFulfillmentStatus('ready')).toBe(true)
    expect(isFulfillmentStatus('collected')).toBe(false)
    expect(isFulfillmentStatus('cancelled')).toBe(false)
    expect(isFulfillmentStatus(undefined)).toBe(false)
    expect(isFulfillmentStatus(3)).toBe(false)
  })
})

describe('resolveFulfillmentState', () => {
  // Test 1: a new order starts Pending.
  it('reads a newly placed order with no record as pending', () => {
    expect(resolveFulfillmentState(placedOrder, null)).toBe('pending')
  })

  it('uses the recorded status when there is one', () => {
    for (const status of FULFILLMENT_STATUSES) {
      expect(resolveFulfillmentState(placedOrder, { status })).toBe(status)
    }
  })

  // The migration guarantee: historical sales must not appear in the kitchen queue.
  it('reads a legacy order with inline payment as delivered', () => {
    expect(resolveFulfillmentState(legacyOrder, null)).toBe('delivered')
  })

  it('lets an explicit record win over the legacy inference', () => {
    expect(resolveFulfillmentState(legacyOrder, { status: 'preparing' })).toBe('preparing')
  })
})

describe('overallStatusOf — the two axes combined', () => {
  // The table from the requirement, row for row.
  it('matches the specified combinations exactly', () => {
    expect(overall('pending', UNPAID)).toBe('pending')
    expect(overall('preparing', UNPAID)).toBe('preparing')
    expect(overall('ready', UNPAID)).toBe('ready')
    expect(overall('delivered', UNPAID)).toBe('payment-outstanding')
    expect(overall('preparing', PAID)).toBe('preparing')
    expect(overall('ready', PAID)).toBe('ready')
    expect(overall('delivered', PAID)).toBe('completed')
  })

  // Test 6.
  it('is Completed only when delivered AND paid', () => {
    expect(isCompleted(overall('delivered', PAID))).toBe(true)
  })

  // Test 5: the state this whole feature exists for.
  it('is NOT completed when delivered but unpaid', () => {
    const status = overall('delivered', UNPAID)
    expect(isCompleted(status)).toBe(false)
    expect(status).toBe('payment-outstanding')
  })

  // Test 7: paying early does not finish an order.
  it('is NOT completed when paid but not yet delivered', () => {
    expect(isCompleted(overall('pending', PAID))).toBe(false)
    expect(isCompleted(overall('preparing', PAID))).toBe(false)
    expect(isCompleted(overall('ready', PAID))).toBe(false)
  })

  it('is never completed for any combination short of delivered and paid', () => {
    for (const fulfillment of FULFILLMENT_STATUSES) {
      for (const payment of [PAID, UNPAID]) {
        const expected = fulfillment === 'delivered' && payment.status === 'paid'
        expect(isCompleted(overall(fulfillment, payment))).toBe(expected)
      }
    }
  })

  it('reports a voided order as voided, whatever the two axes say', () => {
    // Including the combination that would otherwise read as Completed — a cancelled sale is
    // not a finished one.
    expect(overall('delivered', PAID, true)).toBe('voided')
    expect(overall('pending', UNPAID, true)).toBe('voided')
    expect(isCompleted(overall('delivered', PAID, true))).toBe(false)
  })
})

// Test 8, as pure logic: the whole pay-later journey in one place.
describe('the pay-later flow', () => {
  it('ends Completed only at the moment payment is recorded', () => {
    let status: FulfillmentStatus = 'pending'
    expect(overall(status, UNPAID)).toBe('pending')

    status = nextFulfillment(status)!
    expect(overall(status, UNPAID)).toBe('preparing')

    status = nextFulfillment(status)!
    expect(overall(status, UNPAID)).toBe('ready')

    status = nextFulfillment(status)!
    expect(status).toBe('delivered')
    // Food handed over, money not yet taken. Outstanding, emphatically not done.
    expect(overall(status, UNPAID)).toBe('payment-outstanding')
    expect(isCompleted(overall(status, UNPAID))).toBe(false)

    // Nothing about fulfilment changes; the payment document is what completes it.
    expect(overall(status, PAID)).toBe('completed')
    expect(isCompleted(overall(status, PAID))).toBe(true)
  })
})

describe('canAdvanceFulfillment', () => {
  it('offers the next step for every status before the last', () => {
    expect(canAdvanceFulfillment({ current: 'pending', voided: false })).toEqual({
      ok: true,
      next: 'preparing',
    })
    expect(canAdvanceFulfillment({ current: 'preparing', voided: false })).toEqual({
      ok: true,
      next: 'ready',
    })
    expect(canAdvanceFulfillment({ current: 'ready', voided: false })).toEqual({
      ok: true,
      next: 'delivered',
    })
  })

  it('offers nothing once delivered', () => {
    const result = canAdvanceFulfillment({ current: 'delivered', voided: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/already been delivered/i)
  })

  // Test 9, at the UI layer. The rules enforce it independently.
  it('refuses to advance a voided order at any stage', () => {
    for (const current of FULFILLMENT_STATUSES) {
      const result = canAdvanceFulfillment({ current, voided: true })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toMatch(/voided/i)
    }
  })
})

describe('parseOrderFulfillment', () => {
  const base = {
    orderId: 'o1',
    status: 'ready',
    updatedBy: 'staff-uid',
    updatedByName: 'Shared Till',
    updatedByStaffId: 'alice',
    updatedByStaffName: 'Alice',
  }

  it('parses a well-formed record, keeping both identities', () => {
    expect(parseOrderFulfillment('o1', { ...base })).toEqual({
      orderId: 'o1',
      status: 'ready',
      updatedAt: null,
      // The shared account that was signed in...
      updatedBy: 'staff-uid',
      updatedByName: 'Shared Till',
      // ...and the person who actually made the move.
      updatedByStaffId: 'alice',
      updatedByStaffName: 'Alice',
    })
  })

  it('reads a missing or blank operator as absent rather than an empty name', () => {
    const parsed = parseOrderFulfillment('o1', {
      ...base,
      updatedByStaffId: undefined,
      updatedByStaffName: '',
    })

    expect(parsed?.updatedByStaffId).toBeNull()
    expect(parsed?.updatedByStaffName).toBeNull()
  })

  it('takes the document id as the order id, not the field', () => {
    expect(parseOrderFulfillment('o2', { ...base, orderId: 'o1' })?.orderId).toBe('o2')
  })

  it('rejects a status that is not on the progression', () => {
    // Skipped rather than rendered, so the order falls back to its resolved default instead
    // of displaying a state that is not one of the four.
    expect(parseOrderFulfillment('o1', { ...base, status: 'collected' })).toBeNull()
    expect(parseOrderFulfillment('o1', { ...base, status: 'cancelled' })).toBeNull()
    expect(parseOrderFulfillment('o1', { ...base, status: undefined })).toBeNull()
  })

  it('falls back rather than throwing when the mover is missing', () => {
    const parsed = parseOrderFulfillment('o1', {
      ...base,
      updatedBy: undefined,
      updatedByName: undefined,
    })

    expect(parsed?.updatedBy).toBe('')
    expect(parsed?.updatedByName).toBe('Unknown')
  })
})

describe('indexFulfillmentsByOrderId', () => {
  const a = { orderId: 'o1' }
  const b = { orderId: 'o2' }

  it('keys each record by the order it tracks', () => {
    const index = indexFulfillmentsByOrderId([a, b])
    expect(index.get('o1')).toBe(a)
    expect(index.get('o2')).toBe(b)
    // Absent means pending, which is why a missing entry is not an error.
    expect(index.get('never-existed')).toBeUndefined()
  })

  it('tolerates an empty list', () => {
    expect(indexFulfillmentsByOrderId([]).size).toBe(0)
  })
})

describe('fulfillmentOperatorNameOf', () => {
  it('names the operator who made the move, not the shared account', () => {
    // The whole point of the shared-login architecture: "Shared Till" is not an answer to
    // "who started preparing this", and Alice is.
    expect(
      fulfillmentOperatorNameOf({ updatedByStaffName: 'Alice', updatedByName: 'Shared Till' }),
    ).toBe('Alice')
  })

  it('falls back to the account when no operator was recorded', () => {
    expect(
      fulfillmentOperatorNameOf({ updatedByStaffName: null, updatedByName: 'Ada Admin' }),
    ).toBe('Ada Admin')
  })

  it('ignores a whitespace-only operator name and never returns empty', () => {
    expect(
      fulfillmentOperatorNameOf({ updatedByStaffName: '   ', updatedByName: 'Shared Till' }),
    ).toBe('Shared Till')
    expect(fulfillmentOperatorNameOf({ updatedByStaffName: null, updatedByName: '' })).toBe(
      'Unknown',
    )
  })
})

describe('parseFulfillmentTransition', () => {
  const base = {
    orderId: 'o1',
    from: 'pending',
    to: 'preparing',
    updatedBy: 'staff-uid',
    updatedByName: 'Shared Till',
    updatedByStaffId: 'alice',
    updatedByStaffName: 'Alice',
  }

  it('parses a well-formed step', () => {
    expect(parseFulfillmentTransition('t1', 'o1', { ...base })).toEqual({
      id: 't1',
      orderId: 'o1',
      from: 'pending',
      to: 'preparing',
      at: null,
      updatedBy: 'staff-uid',
      updatedByName: 'Shared Till',
      updatedByStaffId: 'alice',
      updatedByStaffName: 'Alice',
    })
  })

  it('rejects a step that does not name two real statuses', () => {
    expect(parseFulfillmentTransition('t1', 'o1', { ...base, from: 'collected' })).toBeNull()
    expect(parseFulfillmentTransition('t1', 'o1', { ...base, to: 'cancelled' })).toBeNull()
    expect(parseFulfillmentTransition('t1', 'o1', { ...base, to: undefined })).toBeNull()
  })

  it('takes the ids from the document path, not the fields', () => {
    const parsed = parseFulfillmentTransition('t2', 'o2', { ...base, orderId: 'o1' })
    expect(parsed?.id).toBe('t2')
    expect(parsed?.orderId).toBe('o2')
  })

  // The reason this journal exists at all.
  it('keeps each step distinct, so one operator does not overwrite another', () => {
    const alice = parseFulfillmentTransition('t1', 'o1', { ...base })
    const bob = parseFulfillmentTransition('t2', 'o1', {
      ...base,
      from: 'preparing',
      to: 'ready',
      updatedByStaffId: 'bob',
      updatedByStaffName: 'Bob',
    })

    expect(fulfillmentOperatorNameOf(alice!)).toBe('Alice')
    expect(fulfillmentOperatorNameOf(bob!)).toBe('Bob')
    // Same order, same shared account, two different people on the record.
    expect(alice!.orderId).toBe(bob!.orderId)
    expect(alice!.updatedBy).toBe(bob!.updatedBy)
    expect(alice!.updatedByStaffName).not.toBe(bob!.updatedByStaffName)
  })

  it('falls back rather than throwing when the mover is missing', () => {
    const parsed = parseFulfillmentTransition('t1', 'o1', {
      ...base,
      updatedBy: undefined,
      updatedByName: undefined,
      updatedByStaffId: undefined,
      updatedByStaffName: undefined,
    })

    expect(parsed?.updatedBy).toBe('')
    expect(parsed?.updatedByName).toBe('Unknown')
    expect(parsed?.updatedByStaffId).toBeNull()
    expect(parsed?.updatedByStaffName).toBeNull()
  })
})
