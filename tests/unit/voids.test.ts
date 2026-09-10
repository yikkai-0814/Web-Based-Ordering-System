import { describe, expect, it } from 'vitest'

import {
  indexVoidsByOrderId,
  isVoided,
  validateVoidReason,
  VOID_REASON_MAX,
} from '@/features/pos/voids'

describe('validateVoidReason', () => {
  it('accepts an ordinary reason and returns it trimmed', () => {
    const result = validateVoidReason('  Wrong item rung up  ')
    expect(result).toEqual({ ok: true, reason: 'Wrong item rung up' })
  })

  it('rejects an empty or whitespace-only reason', () => {
    // A void with no stated reason is a hole in the takings, not an audit trail.
    for (const input of ['', '   ', '\t\n ']) {
      const result = validateVoidReason(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/enter a reason/i)
    }
  })

  it('accepts a reason of exactly the maximum length', () => {
    const result = validateVoidReason('x'.repeat(VOID_REASON_MAX))
    expect(result.ok).toBe(true)
  })

  it('rejects a reason one character over the maximum', () => {
    const result = validateVoidReason('x'.repeat(VOID_REASON_MAX + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/at most 200 characters/i)
  })

  it('measures length after trimming, not before', () => {
    const padded = `   ${'x'.repeat(VOID_REASON_MAX)}   `
    expect(validateVoidReason(padded).ok).toBe(true)
  })
})

describe('indexVoidsByOrderId', () => {
  const voidA = { orderId: 'o1', reason: 'Mis-rung' }
  const voidB = { orderId: 'o2', reason: 'Customer changed their mind' }

  it('keys each void by the order it cancels', () => {
    const index = indexVoidsByOrderId([voidA, voidB])
    expect(index.size).toBe(2)
    expect(index.get('o1')).toBe(voidA)
    expect(index.get('o2')).toBe(voidB)
  })

  it('tolerates an empty list', () => {
    expect(indexVoidsByOrderId([]).size).toBe(0)
  })

  it('reports an order with no void as not voided', () => {
    const index = indexVoidsByOrderId([voidA])
    expect(isVoided('o1', index)).toBe(true)
    expect(isVoided('o2', index)).toBe(false)
    expect(isVoided('never-existed', index)).toBe(false)
  })

  it('reports nothing as voided when there are no voids at all', () => {
    const index = indexVoidsByOrderId([])
    expect(isVoided('o1', index)).toBe(false)
  })
})
