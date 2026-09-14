import { say } from '../say'
import { describe, expect, it } from 'vitest'

import {
  canAdvanceFulfillment,
  FINAL_FULFILLMENT,
  elapsedMsOf,
  elapsedWindowOf,
  ELAPSED_FINAL_LABEL_KEY,
  ELAPSED_LABEL_KEY,
  formatDuration,
  isElapsedFinished,
  nextDeliveredAt,
  nextReadyAt,
  FULFILLMENT_ACTION_KEYS,
  FULFILLMENT_LABEL_KEYS,
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
      expect(say(FULFILLMENT_LABEL_KEYS[status])).toBeTruthy()
    }
    expect(say(FULFILLMENT_ACTION_KEYS.pending!)).toBe('Start preparing')
    expect(say(FULFILLMENT_ACTION_KEYS.ready!)).toBe('Mark delivered')
    // Nothing follows delivered, so there is no button to offer.
    expect(FULFILLMENT_ACTION_KEYS.delivered).toBeNull()
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
    if (!result.ok) expect(say(result.reason)).toMatch(/already been delivered/i)
  })

  // Test 9, at the UI layer. The rules enforce it independently.
  it('refuses to advance a voided order at any stage', () => {
    for (const current of FULFILLMENT_STATUSES) {
      const result = canAdvanceFulfillment({ current, voided: true })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(say(result.reason)).toMatch(/voided/i)
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
      // `base` has neither, exactly as a record written before they were captured. They
      // read as "has not happened", not as a reason to reject the record.
      readyAt: null,
      deliveredAt: null,
    })
  })

  it('keeps a legacy record readable, and reads it as simply not delivered', () => {
    // The pre-feature shape: a real, valid fulfilment with neither timestamp. The order
    // still has a createdAt, so the clock runs — it just never stops until a handover is
    // recorded.
    const parsed = parseOrderFulfillment('o1', { ...base })
    const order = { createdAt: { toDate: () => new Date('2026-09-13T10:00:00.000Z') } }

    expect(parsed).not.toBeNull()
    expect(parsed?.status).toBe('ready')
    const window = elapsedWindowOf(order, parsed)
    expect(isElapsedFinished(window)).toBe(false)
    expect(elapsedMsOf(window, new Date('2026-09-13T10:01:00.000Z').getTime())).toBe(60_000)
  })

  it('ignores a stale preparingAt left on a record by an earlier version', () => {
    // The field is no longer written or read; a document still carrying one must not change
    // what the timer reports.
    const preparingAt = { toDate: () => new Date('2026-09-13T10:04:00.000Z') }
    const deliveredAt = { toDate: () => new Date('2026-09-13T10:05:00.000Z') }
    const parsed = parseOrderFulfillment('o1', { ...base, preparingAt, deliveredAt })
    const order = { createdAt: { toDate: () => new Date('2026-09-13T10:00:00.000Z') } }

    expect('preparingAt' in (parsed ?? {})).toBe(false)
    // Five minutes from creation, not one minute from the stale start.
    expect(elapsedMsOf(elapsedWindowOf(order, parsed), 0)).toBe(300_000)
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

/**
 * Order elapsed time.
 *
 * One claim under test throughout: the clock runs from the order's own `createdAt` and stops
 * at exactly one moment, delivery. Not at `ready`, not at `preparing`, and never at payment.
 */
describe('nextDeliveredAt is what stops the clock', () => {
  it('stamps the handover', () => {
    expect(nextDeliveredAt('ready', 'delivered')).toBe('now')
  })

  it('clears it when an admin corrects delivered back to ready', () => {
    // It was not handed over after all, so the customer is waiting again.
    expect(nextDeliveredAt('delivered', 'ready')).toBeNull()
  })

  it('leaves nothing stamped on any step short of delivery', () => {
    const steps = [
      ['pending', 'preparing'],
      ['preparing', 'ready'],
      ['ready', 'preparing'],
      ['preparing', 'pending'],
    ] as const
    for (const [from, to] of steps) {
      expect(nextDeliveredAt(from, to)).toBeNull()
    }
  })

  it('never preserves a stale stamp, which is what makes the rule total', () => {
    // An order is delivered or it is not; there is no "unchanged" case to get wrong.
    for (const from of FULFILLMENT_STATUSES) {
      for (const to of FULFILLMENT_STATUSES) {
        expect(nextDeliveredAt(from, to)).not.toBe('keep')
      }
    }
  })
})

describe('nextReadyAt still records when the kitchen finished', () => {
  it('stamps ready, and keeps it through delivery', () => {
    expect(nextReadyAt('preparing', 'ready')).toBe('now')
    expect(nextReadyAt('ready', 'delivered')).toBe('keep')
    expect(nextReadyAt('delivered', 'ready')).toBe('keep')
  })

  it('clears it when the order goes back into the kitchen', () => {
    expect(nextReadyAt('ready', 'preparing')).toBeNull()
    expect(nextReadyAt('preparing', 'pending')).toBeNull()
  })
})

describe('the clock runs from creation until delivery, and nothing else', () => {
  const at = (iso: string) => ({ toDate: () => new Date(iso) })
  const CREATED = '2026-09-13T19:30:00.000Z'
  const createdMs = new Date(CREATED).getTime()
  const order = { createdAt: at(CREATED) }

  it('starts immediately on a brand-new order with no fulfilment record', () => {
    const window = elapsedWindowOf(order, null)
    expect(elapsedMsOf(window, createdMs + 3_000)).toBe(3_000)
    expect(isElapsedFinished(window)).toBe(false)
  })

  it('keeps running while the order is pending', () => {
    expect(elapsedMsOf(elapsedWindowOf(order, null), createdMs + 204_000)).toBe(204_000)
  })

  it('keeps running while the order is preparing', () => {
    const preparing = { deliveredAt: null }
    expect(elapsedMsOf(elapsedWindowOf(order, preparing), createdMs + 317_000)).toBe(317_000)
  })

  it('KEEPS RUNNING once the order is ready — the point of this change', () => {
    // readyAt is set and deliberately ignored: an order on the pass is an order the
    // customer has not been given.
    const ready = { readyAt: at('2026-09-13T19:34:00.000Z'), deliveredAt: null }
    const window = elapsedWindowOf(order, ready)
    expect(isElapsedFinished(window)).toBe(false)
    expect(elapsedMsOf(window, createdMs + 462_000)).toBe(462_000)
  })

  it('stops at delivery, and freezes there', () => {
    const delivered = {
      readyAt: at('2026-09-13T19:34:00.000Z'),
      deliveredAt: at('2026-09-13T19:38:15.000Z'),
    }
    const window = elapsedWindowOf(order, delivered)
    expect(isElapsedFinished(window)).toBe(true)
    expect(elapsedMsOf(window, createdMs + 3_600_000)).toBe(495_000)
    expect(formatDuration(elapsedMsOf(window, 0) ?? 0)).toBe('8:15')
  })

  it('measures deliveredAt minus createdAt, whatever readyAt says', () => {
    // Same delivery, a wildly different ready time: the number does not move.
    const early = {
      readyAt: at('2026-09-13T19:31:00.000Z'),
      deliveredAt: at('2026-09-13T19:38:15.000Z'),
    }
    const late = {
      readyAt: at('2026-09-13T19:38:00.000Z'),
      deliveredAt: at('2026-09-13T19:38:15.000Z'),
    }
    expect(elapsedMsOf(elapsedWindowOf(order, early), 0)).toBe(495_000)
    expect(elapsedMsOf(elapsedWindowOf(order, late), 0)).toBe(495_000)
  })

  it('runs again from the original start if delivery is corrected away', () => {
    // deliveredAt is cleared by that step; createdAt never moved.
    const window = elapsedWindowOf(order, { deliveredAt: null })
    expect(isElapsedFinished(window)).toBe(false)
    expect(elapsedMsOf(window, createdMs + 900_000)).toBe(900_000)
  })

  it('has nothing to report before the order has a resolved creation time', () => {
    expect(elapsedMsOf(elapsedWindowOf({ createdAt: null }, null), 0)).toBeNull()
    expect(elapsedMsOf(elapsedWindowOf(null, null), 0)).toBeNull()
  })

  it('never reports a negative duration', () => {
    const window = elapsedWindowOf(order, { deliveredAt: at('2026-09-13T19:29:00.000Z') })
    expect(elapsedMsOf(window, createdMs)).toBe(0)
  })
})

describe('formatDuration reads like a counter', () => {
  it('shows minutes and seconds, seconds always two digits', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9_000)).toBe('0:09')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(495_000)).toBe('8:15')
  })

  it('grows an hours field only once it needs one', () => {
    expect(formatDuration(3_599_000)).toBe('59:59')
    expect(formatDuration(3_600_000)).toBe('1:00:00')
    expect(formatDuration(3_827_000)).toBe('1:03:47')
  })

  it('floors rather than rounds, so no second is shown before it has passed', () => {
    expect(formatDuration(1_999)).toBe('0:01')
  })

  it('clamps below zero', () => {
    expect(formatDuration(-5_000)).toBe('0:00')
  })

  it('says what the number is, running and stopped', () => {
    expect(say(ELAPSED_LABEL_KEY)).toBe('Time since ordered')
    expect(say(ELAPSED_FINAL_LABEL_KEY)).toBe('Total time to delivery')
  })
})
