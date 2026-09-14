import { say } from '../say'
import { describe, expect, it } from 'vitest'

import { voidInitiatorNameOf } from '@/features/pos/types'
import {
  indexVoidsByOrderId,
  isVoided,
  validateManagerCredentials,
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
      if (!result.ok) expect(result.error.key).toBe('validation.voidReasonRequired')
    }
  })

  it('accepts a reason of exactly the maximum length', () => {
    const result = validateVoidReason('x'.repeat(VOID_REASON_MAX))
    expect(result.ok).toBe(true)
  })

  it('rejects a reason one character over the maximum', () => {
    const result = validateVoidReason('x'.repeat(VOID_REASON_MAX + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(say(result.error)).toMatch(/at most 200 characters/i)
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

/**
 * Phase 11. This validates the FORM, not the credentials — whether these are a manager's is
 * settled by Firebase Auth and then by firestore.rules, and nothing here could stand in for
 * that. What it saves is a pointless round trip and an opaque error on an empty field.
 */
describe('validateManagerCredentials', () => {
  it('accepts a filled-in form and returns the email trimmed', () => {
    const result = validateManagerCredentials('  ada@example.com  ', 'hunter2')
    expect(result).toEqual({ ok: true, email: 'ada@example.com', password: 'hunter2' })
  })

  it('rejects a missing email', () => {
    expect(validateManagerCredentials('', 'hunter2').ok).toBe(false)
    expect(validateManagerCredentials('   ', 'hunter2').ok).toBe(false)
  })

  it('rejects a missing password', () => {
    const result = validateManagerCredentials('ada@example.com', '')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(say(result.error)).toMatch(/password/i)
  })

  it('does not trim the password — leading and trailing spaces are part of it', () => {
    const result = validateManagerCredentials('ada@example.com', '  spaced  ')
    expect(result).toEqual({ ok: true, email: 'ada@example.com', password: '  spaced  ' })
  })

  it('leaves the shape of the address to Firebase', () => {
    // Not this function's job to decide: a client-side email regex rejects valid addresses
    // without making anything safer, and the sign-in will reject it in a moment anyway.
    expect(validateManagerCredentials('not-an-email', 'hunter2').ok).toBe(true)
  })
})

describe('voidInitiatorNameOf', () => {
  it('names the initiator when there is one', () => {
    expect(
      voidInitiatorNameOf({ initiatedByStaffName: 'Sam Staff', voidedByName: 'Ada Admin' }),
    ).toBe('Sam Staff')
  })

  it('falls back to the authoriser on a pre-Phase-11 void', () => {
    // Those voids recorded only the admin who did both, and are never backfilled: voids are
    // immutable, so naming the authoriser is the honest answer rather than a guess.
    expect(voidInitiatorNameOf({ initiatedByStaffName: null, voidedByName: 'Ada Admin' })).toBe(
      'Ada Admin',
    )
  })

  it('never returns an empty string', () => {
    expect(voidInitiatorNameOf({ initiatedByStaffName: '  ', voidedByName: '' })).toBe('Unknown')
  })
})
