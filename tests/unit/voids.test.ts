import { say } from '../say'
import { describe, expect, it } from 'vitest'

import { voidInitiatorNameOf } from '@/features/pos/types'
import {
  findVoidReasonPreset,
  indexVoidsByOrderId,
  isVoided,
  resolveVoidReason,
  validateManagerCredentials,
  validateVoidReason,
  VOID_REASON_MAX,
  VOID_REASON_OTHER,
  VOID_REASON_PRESETS,
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

/**
 * The quick reasons. They save typing; they do not relax anything — every route through
 * `resolveVoidReason` ends at `validateVoidReason`, so a void still cannot be written
 * without a stated reason.
 */
describe('the quick void reasons', () => {
  it('offers the seven common ones, each with its own id', () => {
    expect(VOID_REASON_PRESETS.map((preset) => preset.id)).toEqual([
      'customer-changed-mind',
      'wrong-order',
      'wrong-item',
      'duplicate-order',
      'payment-issue',
      'item-unavailable',
      'staff-mistake',
    ])
  })

  it('translates every one of them, rather than hard-coding English', () => {
    // The label key is what the dialog reads; a preset with none would show a blank option.
    for (const preset of VOID_REASON_PRESETS) {
      expect(preset.labelKey.startsWith('void.reason')).toBe(true)
    }
  })

  it('does not include "Other" among them — it is the absence of a preset', () => {
    expect(VOID_REASON_PRESETS.some((preset) => preset.id === VOID_REASON_OTHER)).toBe(false)
    expect(findVoidReasonPreset(VOID_REASON_OTHER)).toBeNull()
  })

  it('finds a preset by id, and answers null for anything it does not know', () => {
    expect(findVoidReasonPreset('wrong-item')?.labelKey).toBe('void.reasonWrongItem')
    expect(findVoidReasonPreset('')).toBeNull()
    expect(findVoidReasonPreset('from-an-older-build')).toBeNull()
  })
})

describe('resolveVoidReason', () => {
  it('stores the label of the preset that was chosen', () => {
    // The label as the operator read it, in the language the till is set to — the same kind
    // of human sentence a typed reason has always been.
    expect(resolveVoidReason('wrong-item', 'Wrong item', '')).toEqual({
      ok: true,
      reason: 'Wrong item',
    })
  })

  it('ignores anything left in the custom field once a preset is chosen', () => {
    // Somebody types under "Other", changes their mind and picks a preset: what they picked
    // is what gets written, not the half-finished sentence behind it.
    expect(resolveVoidReason('payment-issue', 'Payment issue', 'Card machine we')).toEqual({
      ok: true,
      reason: 'Payment issue',
    })
  })

  it('refuses to resolve anything until a reason has been chosen', () => {
    const result = resolveVoidReason('', '', '')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.key).toBe('validation.voidReasonNotSelected')
  })

  it('requires words of their own when "Other" is chosen', () => {
    for (const typed of ['', '   ']) {
      const result = resolveVoidReason(VOID_REASON_OTHER, '', typed)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.key).toBe('validation.voidReasonRequired')
    }
  })

  it('accepts and trims a custom reason, exactly as the typed field always did', () => {
    expect(resolveVoidReason(VOID_REASON_OTHER, '', '  Spilled the tray  ')).toEqual({
      ok: true,
      reason: 'Spilled the tray',
    })
  })

  it('holds a custom reason to the same maximum length', () => {
    const tooLong = 'x'.repeat(VOID_REASON_MAX + 1)
    const result = resolveVoidReason(VOID_REASON_OTHER, '', tooLong)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.key).toBe('validation.voidReasonTooLong')
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
