import { say } from '../say'
import { describe, expect, it } from 'vitest'

import {
  isOrderType,
  ORDER_TYPE_LABEL_KEYS,
  ORDER_TYPES,
  orderTypeSummaryOf,
  TABLE_NUMBER_MAX,
  validatePlacement,
  validateTableNumber,
} from '@/features/pos/order-type'
import { parseOrder } from '@/features/pos/types'

describe('order types', () => {
  it('offers exactly two, dine-in and takeaway', () => {
    expect(ORDER_TYPES).toEqual(['dine_in', 'takeaway'])
    expect(say(ORDER_TYPE_LABEL_KEYS.dine_in)).toBe('Dine-in')
    expect(say(ORDER_TYPE_LABEL_KEYS.takeaway)).toBe('Takeaway')
  })

  it('recognises only those two values', () => {
    expect(isOrderType('dine_in')).toBe(true)
    expect(isOrderType('takeaway')).toBe(true)
  })

  it('rejects near-misses and non-strings', () => {
    // A stale client sending any of these must not have it quietly accepted.
    for (const value of ['dinein', 'dine-in', 'DINE_IN', 'delivery', 'eat_in', '']) {
      expect(isOrderType(value)).toBe(false)
    }
    expect(isOrderType(undefined)).toBe(false)
    expect(isOrderType(null)).toBe(false)
    expect(isOrderType(5)).toBe(false)
  })
})

describe('validateTableNumber', () => {
  it('accepts the shapes a café actually uses', () => {
    for (const value of ['5', '12', 'A3', 'T12', '12B', 'a1']) {
      expect(validateTableNumber(value)).toEqual({ ok: true, tableNumber: value })
    }
  })

  it('returns the trimmed value, so callers store what was validated', () => {
    expect(validateTableNumber('  5 ')).toEqual({ ok: true, tableNumber: '5' })
    expect(validateTableNumber('\tA3\n')).toEqual({ ok: true, tableNumber: 'A3' })
  })

  it('rejects an empty or whitespace-only entry', () => {
    for (const value of ['', '   ', '\t', '\n']) {
      const result = validateTableNumber(value)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.key).toBe('validation.tableRequired')
    }
  })

  it('enforces the length ceiling, measured after trimming', () => {
    const longest = 'A'.repeat(TABLE_NUMBER_MAX)
    expect(validateTableNumber(longest)).toEqual({ ok: true, tableNumber: longest })
    // Padding does not count against the limit — it is trimmed first.
    expect(validateTableNumber(`  ${longest}  `)).toEqual({ ok: true, tableNumber: longest })

    const tooLong = 'A'.repeat(TABLE_NUMBER_MAX + 1)
    const result = validateTableNumber(tooLong)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(say(result.error)).toMatch(/at most 8 characters/i)
  })

  it('rejects anything that is not a letter or a digit', () => {
    // Mirrors the rules regex, which has no trim() and must therefore refuse inner spaces
    // and punctuation outright rather than relying on this function having run.
    for (const value of ['A-3', 'T 12', '5!', 'a b', '#4', '5.0', 'té']) {
      const result = validateTableNumber(value)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.key).toBe('validation.tableCharacters')
    }
  })
})

describe('validatePlacement', () => {
  it('accepts a dine-in order with a table number', () => {
    expect(validatePlacement('dine_in', ' A3 ')).toEqual({
      ok: true,
      orderType: 'dine_in',
      tableNumber: 'A3',
    })
  })

  it('refuses a dine-in order with no table number', () => {
    const result = validatePlacement('dine_in', '')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.key).toBe('validation.tableRequired')
  })

  it('refuses a dine-in order whose table number is invalid', () => {
    expect(validatePlacement('dine_in', '   ').ok).toBe(false)
    expect(validatePlacement('dine_in', 'A'.repeat(9)).ok).toBe(false)
    expect(validatePlacement('dine_in', 'A-3').ok).toBe(false)
  })

  it('accepts a takeaway with no table number', () => {
    expect(validatePlacement('takeaway', '')).toEqual({
      ok: true,
      orderType: 'takeaway',
      tableNumber: null,
    })
  })

  it('discards a table number left over from a mis-tap on a takeaway', () => {
    // Not an error: the field is hidden for takeaway, and refusing a value the UI can still
    // be holding would make the place-order button flicker as somebody toggles.
    expect(validatePlacement('takeaway', '5')).toEqual({
      ok: true,
      orderType: 'takeaway',
      tableNumber: null,
    })
    // Even an invalid one, since nothing is written either way.
    expect(validatePlacement('takeaway', 'A-3!!!!!!!!').ok).toBe(true)
  })
})

describe('orderTypeSummaryOf', () => {
  it('names the table for a dine-in order', () => {
    expect(say(orderTypeSummaryOf({ orderType: 'dine_in', tableNumber: '5' }))).toBe(
      'Dine-in · Table 5',
    )
    expect(say(orderTypeSummaryOf({ orderType: 'dine_in', tableNumber: 'A3' }))).toBe(
      'Dine-in · Table A3',
    )
  })

  it('never shows a table for a takeaway, even if one somehow reached the document', () => {
    expect(say(orderTypeSummaryOf({ orderType: 'takeaway', tableNumber: null }))).toBe('Takeaway')
    expect(say(orderTypeSummaryOf({ orderType: 'takeaway', tableNumber: '5' }))).toBe('Takeaway')
  })

  it('says "Not recorded" for an order placed before order types existed', () => {
    // The honest answer. Guessing a type would invent history that never happened.
    expect(say(orderTypeSummaryOf({ orderType: null, tableNumber: null }))).toBe('Not recorded')
  })

  it('degrades to plain Dine-in rather than "Table null"', () => {
    // Structurally impossible for a new order — the rules refuse it — but reachable for a
    // hand-written document, and a receipt must never render the word "null".
    expect(say(orderTypeSummaryOf({ orderType: 'dine_in', tableNumber: null }))).toBe('Dine-in')
  })

  it('never returns an empty string', () => {
    for (const orderType of [...ORDER_TYPES, null]) {
      for (const tableNumber of ['5', null]) {
        expect(say(orderTypeSummaryOf({ orderType, tableNumber }))).not.toBe('')
      }
    }
  })
})

describe('parseOrder and the new fields', () => {
  const base = {
    number: 1,
    businessDate: '2026-09-11',
    lines: [{ menuItemId: 'i1', name: 'Flat White', unitPrice: 1250, quantity: 1 }],
    total: 1250,
    createdBy: 'staff-uid',
    createdByName: 'Shared Till',
    staffId: 'alice',
    staffName: 'Alice',
  }

  it('round-trips a dine-in order', () => {
    const parsed = parseOrder('o1', { ...base, orderType: 'dine_in', tableNumber: '5' })
    expect(parsed?.orderType).toBe('dine_in')
    expect(parsed?.tableNumber).toBe('5')
  })

  it('round-trips a takeaway, which carries no table key at all', () => {
    const parsed = parseOrder('o1', { ...base, orderType: 'takeaway' })
    expect(parsed?.orderType).toBe('takeaway')
    expect(parsed?.tableNumber).toBeNull()
  })

  // The legacy guarantee, and the reason these are coerced rather than fatal.
  it('still parses an order that has neither field', () => {
    const parsed = parseOrder('o1', { ...base })

    expect(parsed).not.toBeNull()
    expect(parsed?.orderType).toBeNull()
    expect(parsed?.tableNumber).toBeNull()
    // And it renders honestly rather than being hidden from the list.
    expect(say(orderTypeSummaryOf(parsed!))).toBe('Not recorded')
  })

  it('treats an unrecognised order type as absent rather than discarding the sale', () => {
    for (const orderType of ['delivery', 'DINE_IN', '', 42, null]) {
      const parsed = parseOrder('o1', { ...base, orderType })
      expect(parsed).not.toBeNull()
      expect(parsed?.orderType).toBeNull()
    }
  })

  it('treats a blank or non-string table number as absent', () => {
    expect(
      parseOrder('o1', { ...base, orderType: 'dine_in', tableNumber: '' })?.tableNumber,
    ).toBeNull()
    expect(
      parseOrder('o1', { ...base, orderType: 'dine_in', tableNumber: 5 })?.tableNumber,
    ).toBeNull()
  })
})
