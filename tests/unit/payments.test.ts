import { describe, expect, it } from 'vitest'

import { changeDue } from '@/features/pos/cart'
import {
  canRecordPayment,
  indexPaymentsByOrderId,
  isPaid,
  PAYMENT_STATUS_LABELS,
  resolvePaymentState,
  type PayableOrder,
  type RecordedPayment,
} from '@/features/pos/payments'
import { parseOrder, parseOrderPayment, paymentOperatorNameOf } from '@/features/pos/types'

/** An order created the new way: placed, unpaid, carrying no inline payment fields. */
const unpaidOrder = (over: Partial<PayableOrder> = {}): PayableOrder => ({
  paymentMethod: null,
  cashTendered: null,
  changeGiven: null,
  ...over,
})

/**
 * An order written before payment became a separate step. It carries the method inline and
 * has always meant "paid".
 */
const legacyCashOrder = (): PayableOrder => ({
  paymentMethod: 'cash',
  cashTendered: 5000,
  changeGiven: 1810,
})

const cashPayment = (over: Partial<RecordedPayment> = {}): RecordedPayment => ({
  method: 'cash',
  cashTendered: 2000,
  changeGiven: 450,
  ...over,
})

describe('resolvePaymentState', () => {
  it('reports a freshly placed order as unpaid', () => {
    const state = resolvePaymentState(unpaidOrder(), null)
    expect(state.status).toBe('unpaid')
    expect(isPaid(state)).toBe(false)
  })

  it('reports an order with a recorded payment as paid, carrying the cash figures', () => {
    const state = resolvePaymentState(unpaidOrder(), cashPayment())

    expect(state).toEqual({
      status: 'paid',
      method: 'cash',
      cashTendered: 2000,
      changeGiven: 450,
      source: 'recorded',
    })
    expect(isPaid(state)).toBe(true)
  })

  it('records an e-wallet payment with no cash figures', () => {
    const state = resolvePaymentState(
      unpaidOrder(),
      cashPayment({ method: 'ewallet', cashTendered: null, changeGiven: null }),
    )

    expect(state).toEqual({
      status: 'paid',
      method: 'ewallet',
      cashTendered: null,
      changeGiven: null,
      source: 'recorded',
    })
  })

  // The migration guarantee: no backfill, no rewritten history, and old receipts keep
  // reading exactly as they did.
  it('treats a legacy order carrying inline payment as paid', () => {
    const state = resolvePaymentState(legacyCashOrder(), null)

    expect(state).toEqual({
      status: 'paid',
      method: 'cash',
      cashTendered: 5000,
      changeGiven: 1810,
      source: 'legacy',
    })
  })

  it('prefers a recorded payment over inline fields when somehow both exist', () => {
    const state = resolvePaymentState(legacyCashOrder(), cashPayment({ method: 'ewallet' }))

    // The payment document is the authority; the inline fields are only a fallback for
    // orders that never got one.
    expect(state.status).toBe('paid')
    expect(state).toMatchObject({ method: 'ewallet', source: 'recorded' })
  })
})

describe('canRecordPayment', () => {
  it('allows payment on an unpaid, unvoided order', () => {
    const state = resolvePaymentState(unpaidOrder(), null)
    expect(canRecordPayment({ state, voided: false })).toEqual({ ok: true })
  })

  it('refuses a second payment on an order already paid', () => {
    const state = resolvePaymentState(unpaidOrder(), cashPayment())
    const result = canRecordPayment({ state, voided: false })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/already been paid/i)
  })

  it('refuses payment on a legacy order, which is already paid', () => {
    const state = resolvePaymentState(legacyCashOrder(), null)
    expect(canRecordPayment({ state, voided: false }).ok).toBe(false)
  })

  it('refuses payment on a voided order', () => {
    const state = resolvePaymentState(unpaidOrder(), null)
    const result = canRecordPayment({ state, voided: true })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/voided/i)
  })

  // Voiding an unpaid order is the ordinary case, but a paid one can be voided too and the
  // refusal must not depend on which reason is checked first.
  it('refuses payment on an order that is both paid and voided', () => {
    const state = resolvePaymentState(unpaidOrder(), cashPayment())
    expect(canRecordPayment({ state, voided: true }).ok).toBe(false)
  })
})

describe('cash arithmetic for a recorded payment', () => {
  // The worked example from the requirement: RM 15.50 total, RM 20.00 given, RM 4.50 back.
  it('computes change in whole sen', () => {
    expect(changeDue(1550, 2000)).toEqual({ ok: true, change: 450 })
  })

  it('accepts the exact amount, giving no change', () => {
    expect(changeDue(1550, 1550)).toEqual({ ok: true, change: 0 })
  })

  it('rejects insufficient cash rather than returning negative change', () => {
    const result = changeDue(1550, 1500)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/less than the total/i)
  })

  it('rejects a fractional sen amount', () => {
    expect(changeDue(1550, 2000.5).ok).toBe(false)
  })
})

describe('PAYMENT_STATUS_LABELS', () => {
  it('says PAID and UNPAID, in the words the counter has to read at a glance', () => {
    expect(PAYMENT_STATUS_LABELS.paid).toBe('PAID')
    expect(PAYMENT_STATUS_LABELS.unpaid).toBe('UNPAID')
  })
})

describe('indexPaymentsByOrderId', () => {
  const a = { orderId: 'o1' }
  const b = { orderId: 'o2' }

  it('keys each payment by the order it settles', () => {
    const index = indexPaymentsByOrderId([a, b])
    expect(index.get('o1')).toBe(a)
    expect(index.get('o2')).toBe(b)
    expect(index.get('never-existed')).toBeUndefined()
  })

  it('tolerates an empty list', () => {
    expect(indexPaymentsByOrderId([]).size).toBe(0)
  })
})

describe('parseOrder with payment removed from the order', () => {
  const base = {
    number: 1,
    businessDate: '2026-09-11',
    lines: [{ menuItemId: 'i1', name: 'Flat White', unitPrice: 1250, quantity: 1 }],
    total: 1250,
    orderType: 'dine_in',
    tableNumber: '5',
    createdBy: 'staff-uid',
    createdByName: 'Sam Staff',
    staffId: 'alice',
    staffName: 'Alice',
  }

  // Before this change an order without a payment method was discarded entirely. It is now
  // the normal shape, and discarding it would hide every unpaid order from the app.
  it('keeps an order that carries no payment method', () => {
    const parsed = parseOrder('o1', { ...base })

    expect(parsed).not.toBeNull()
    expect(parsed?.paymentMethod).toBeNull()
    expect(parsed?.cashTendered).toBeNull()
    expect(parsed?.changeGiven).toBeNull()
  })

  it('keeps a legacy order and preserves its inline payment fields', () => {
    const parsed = parseOrder('o1', {
      ...base,
      paymentMethod: 'cash',
      cashTendered: 2000,
      changeGiven: 750,
    })

    expect(parsed?.paymentMethod).toBe('cash')
    expect(parsed?.cashTendered).toBe(2000)
    expect(parsed?.changeGiven).toBe(750)
  })

  it('treats an unrecognised method as no method rather than discarding the sale', () => {
    const parsed = parseOrder('o1', { ...base, paymentMethod: 'bitcoin' })

    expect(parsed).not.toBeNull()
    expect(parsed?.paymentMethod).toBeNull()
  })

  it('still rejects an order that is malformed in ways that matter', () => {
    expect(parseOrder('o1', { ...base, total: 12.5 })).toBeNull()
    expect(parseOrder('o1', { ...base, lines: [] })).toBeNull()
    expect(parseOrder('o1', { ...base, number: 0 })).toBeNull()
  })
})

describe('parseOrderPayment', () => {
  const base = {
    orderId: 'o1',
    method: 'cash',
    amount: 1550,
    cashTendered: 2000,
    changeGiven: 450,
    paidBy: 'staff-uid',
    paidByName: 'Shared Till',
    paidByStaffId: 'alice',
    paidByStaffName: 'Alice',
  }

  it('parses a cash payment, keeping both identities', () => {
    expect(parseOrderPayment('o1', { ...base })).toEqual({
      orderId: 'o1',
      method: 'cash',
      amount: 1550,
      cashTendered: 2000,
      changeGiven: 450,
      paidAt: null,
      // The shared account that was signed in...
      paidBy: 'staff-uid',
      paidByName: 'Shared Till',
      // ...and the person who actually took the money.
      paidByStaffId: 'alice',
      paidByStaffName: 'Alice',
    })
  })

  it('reads a missing or blank operator as absent rather than an empty name', () => {
    const parsed = parseOrderPayment('o1', {
      ...base,
      paidByStaffId: undefined,
      paidByStaffName: '',
    })

    expect(parsed?.paidByStaffId).toBeNull()
    expect(parsed?.paidByStaffName).toBeNull()
  })

  it('parses an e-wallet payment with null cash figures', () => {
    const parsed = parseOrderPayment('o1', {
      ...base,
      method: 'ewallet',
      cashTendered: null,
      changeGiven: null,
    })

    expect(parsed?.method).toBe('ewallet')
    expect(parsed?.cashTendered).toBeNull()
    expect(parsed?.changeGiven).toBeNull()
  })

  it('takes the document id as the order id, not the field', () => {
    // The rules force the two to agree; this makes the parser independent of that anyway.
    expect(parseOrderPayment('o2', { ...base, orderId: 'o1' })?.orderId).toBe('o2')
  })

  it('rejects a payment whose method is not one the café takes', () => {
    expect(parseOrderPayment('o1', { ...base, method: 'cheque' })).toBeNull()
    expect(parseOrderPayment('o1', { ...base, method: undefined })).toBeNull()
  })

  it('rejects a payment whose amount is not whole sen', () => {
    expect(parseOrderPayment('o1', { ...base, amount: 15.5 })).toBeNull()
    expect(parseOrderPayment('o1', { ...base, amount: -100 })).toBeNull()
  })

  it('falls back rather than throwing when the recorder is missing', () => {
    const parsed = parseOrderPayment('o1', { ...base, paidBy: undefined, paidByName: undefined })

    expect(parsed?.paidBy).toBe('')
    expect(parsed?.paidByName).toBe('Unknown')
  })
})

describe('paymentOperatorNameOf', () => {
  it('names the operator who took the money, not the shared account', () => {
    // The whole point of the shared-login architecture: "Shared Till" is not an answer to
    // "who took this money", and Alice is.
    expect(paymentOperatorNameOf({ paidByStaffName: 'Alice', paidByName: 'Shared Till' })).toBe(
      'Alice',
    )
  })

  it('falls back to the account when no operator was recorded', () => {
    expect(paymentOperatorNameOf({ paidByStaffName: null, paidByName: 'Ada Admin' })).toBe(
      'Ada Admin',
    )
  })

  it('ignores a whitespace-only operator name', () => {
    expect(paymentOperatorNameOf({ paidByStaffName: '   ', paidByName: 'Shared Till' })).toBe(
      'Shared Till',
    )
  })

  it('never returns an empty string', () => {
    expect(paymentOperatorNameOf({ paidByStaffName: null, paidByName: '' })).toBe('Unknown')
  })
})
