import { describe, expect, it } from 'vitest'

import {
  canAdvanceFulfillment,
  FINAL_FULFILLMENT,
  formatDuration,
  isPreparationFinished,
  nextReadyAt,
  preparationElapsedMs,
  preparationWindowOf,
  PREPARATION_LABEL,
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
      // `base` has no readyAt, exactly as a record written before it was captured. It reads
      // as "not finished", not as a reason to reject the record.
      readyAt: null,
    })
  })

  it('keeps a legacy record readable, and reads it as simply not finished', () => {
    // The pre-feature shape: a real, valid fulfilment with no readyAt at all. The order
    // still has a createdAt, so the timer runs — it just never stops until one is recorded.
    const parsed = parseOrderFulfillment('o1', { ...base })
    const order = { createdAt: { toDate: () => new Date('2026-09-13T10:00:00.000Z') } }

    expect(parsed).not.toBeNull()
    expect(parsed?.status).toBe('ready')
    const window = preparationWindowOf(order, parsed)
    expect(isPreparationFinished(window)).toBe(false)
    expect(preparationElapsedMs(window, new Date('2026-09-13T10:01:00.000Z').getTime())).toBe(
      60_000,
    )
  })

  it('ignores a stale preparingAt left on a record by an earlier version', () => {
    // The field is no longer written or read; a document still carrying one must not change
    // what the timer reports.
    const preparingAt = { toDate: () => new Date('2026-09-13T10:04:00.000Z') }
    const readyAt = { toDate: () => new Date('2026-09-13T10:05:00.000Z') }
    const parsed = parseOrderFulfillment('o1', { ...base, preparingAt, readyAt })
    const order = { createdAt: { toDate: () => new Date('2026-09-13T10:00:00.000Z') } }

    expect('preparingAt' in (parsed ?? {})).toBe(false)
    // Five minutes from creation, not one minute from the stale start.
    expect(preparationElapsedMs(preparationWindowOf(order, parsed), 0)).toBe(300_000)
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
 * Preparation timing.
 *
 * The thing under test throughout is that preparation means the ORDER'S OWN `createdAt` to
 * `readyAt`. Not the moment somebody pressed "Start preparing", and above all not anything
 * to do with payment: a ticket that waits before the kitchen picks it up has still kept the
 * customer waiting, and that wait is the number being shown.
 */
describe('nextReadyAt decides what each step does to the finish time', () => {
  it('does not record a finish when preparation begins', () => {
    expect(nextReadyAt('pending', 'preparing')).toBeNull()
  })

  it('records the finish at ready — the one moment being measured', () => {
    expect(nextReadyAt('preparing', 'ready')).toBe('now')
  })

  it('leaves a recorded finish alone when the order is handed over', () => {
    expect(nextReadyAt('ready', 'delivered')).toBe('keep')
  })

  it('leaves it alone again when an admin corrects delivered back to ready', () => {
    // A fulfilment correction, not the order being finished a second time.
    expect(nextReadyAt('delivered', 'ready')).toBe('keep')
  })

  it('clears the finish when ready is corrected back to preparing', () => {
    // The order is being worked on again, so it must stop claiming to be done — and the
    // timer starts running again from the order's creation, which never moved.
    expect(nextReadyAt('ready', 'preparing')).toBeNull()
  })

  it('clears it when the order is corrected all the way back to pending', () => {
    expect(nextReadyAt('preparing', 'pending')).toBeNull()
  })

  it('never has anything to say about a start, because it does not own one', () => {
    // Every step is covered by the table above; none of them can move the clock's start,
    // which lives on the immutable order document.
    const steps = [
      ['pending', 'preparing'],
      ['preparing', 'ready'],
      ['ready', 'delivered'],
      ['delivered', 'ready'],
      ['ready', 'preparing'],
      ['preparing', 'pending'],
    ] as const
    for (const [from, to] of steps) {
      expect(['now', 'keep', null]).toContain(nextReadyAt(from, to))
    }
  })
})

describe('preparation duration runs from the order, not from the kitchen', () => {
  const at = (iso: string) => ({ toDate: () => new Date(iso) })
  const CREATED = '2026-09-13T19:30:00.000Z'
  const createdMs = new Date(CREATED).getTime()
  const order = { createdAt: at(CREATED) }

  it('is the worked example: created 7:30:00, ready 7:42:30, so 12m 30s', () => {
    const window = preparationWindowOf(order, { readyAt: at('2026-09-13T19:42:30.000Z') })
    expect(preparationElapsedMs(window, 0)).toBe(750_000)
    expect(formatDuration(preparationElapsedMs(window, 0) ?? 0)).toBe('12:30')
  })

  it('starts immediately on a brand-new order, with no fulfilment record at all', () => {
    // Nothing has happened to this order yet: not paid, not started, no sidecar.
    const window = preparationWindowOf(order, null)
    expect(preparationElapsedMs(window, createdMs + 3_000)).toBe(3_000)
    expect(isPreparationFinished(window)).toBe(false)
  })

  it('keeps counting while the order is pending, unpaid and untouched', () => {
    const window = preparationWindowOf(order, null)
    expect(preparationElapsedMs(window, createdMs + 60_000)).toBe(60_000)
    expect(preparationElapsedMs(window, createdMs + 300_000)).toBe(300_000)
  })

  it('keeps counting once it is preparing, from the SAME start', () => {
    // The fulfilment record exists now, and it changes nothing about where the clock began.
    const window = preparationWindowOf(order, { readyAt: null })
    expect(preparationElapsedMs(window, createdMs + 420_000)).toBe(420_000)
  })

  it('freezes at readyAt, and ignores the clock entirely once it has', () => {
    const window = preparationWindowOf(order, { readyAt: at('2026-09-13T19:42:30.000Z') })
    expect(isPreparationFinished(window)).toBe(true)
    // An hour later the answer is the same: the duration is history, not a running total.
    expect(preparationElapsedMs(window, createdMs + 3_600_000)).toBe(750_000)
    expect(preparationElapsedMs(window, createdMs)).toBe(750_000)
  })

  it('is unchanged by delivery, which touches neither timestamp', () => {
    const atReady = preparationWindowOf(order, { readyAt: at('2026-09-13T19:42:30.000Z') })
    const atDelivered = preparationWindowOf(order, { readyAt: at('2026-09-13T19:42:30.000Z') })
    expect(preparationElapsedMs(atDelivered, 0)).toBe(preparationElapsedMs(atReady, 0))
  })

  it('runs again from the original start when ready is corrected back to preparing', () => {
    // readyAt is cleared by that step; createdAt was never touched, so the timer simply
    // resumes counting the order's whole life rather than starting a second stopwatch.
    const window = preparationWindowOf(order, { readyAt: null })
    expect(isPreparationFinished(window)).toBe(false)
    expect(preparationElapsedMs(window, createdMs + 900_000)).toBe(900_000)
  })

  it('has nothing to report before the order has a resolved creation time', () => {
    // A just-written order whose serverTimestamp has not come back from the server yet.
    expect(preparationElapsedMs(preparationWindowOf({ createdAt: null }, null), 0)).toBeNull()
    expect(preparationElapsedMs(preparationWindowOf(null, null), 0)).toBeNull()
  })

  it('never reports a negative duration', () => {
    const window = preparationWindowOf(order, { readyAt: at('2026-09-13T19:29:00.000Z') })
    expect(preparationElapsedMs(window, createdMs)).toBe(0)
  })
})

describe('formatDuration reads like a counter', () => {
  it('shows minutes and seconds, seconds always two digits', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9_000)).toBe('0:09')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(750_000)).toBe('12:30')
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

  it('labels the number so it cannot be read as something else', () => {
    expect(PREPARATION_LABEL).toBe('Prep time')
  })
})
