import { describe, expect, it } from 'vitest'

import { openingEntryFrom } from '@/features/menu/cost-history'

const recordedAt = new Date('2026-09-11T10:00:00')

describe('openingEntryFrom', () => {
  it('backfills the outgoing cost for a legacy item that has no journal', () => {
    // The case this exists for: a cost recorded before the journal existed. Editing it
    // must not erase what earlier sales already resolved to.
    expect(openingEntryFrom(200, false, recordedAt)).toEqual({
      cost: 200,
      effectiveFrom: recordedAt,
    })
  })

  it('dates the opening entry when the OLD cost was recorded, never "now"', () => {
    const entry = openingEntryFrom(200, false, recordedAt)
    expect(entry?.effectiveFrom).toBe(recordedAt)
  })

  it('returns null when the item already has history — the journal is authoritative', () => {
    expect(openingEntryFrom(200, true, recordedAt)).toBeNull()
  })

  it('returns null when there is no previous cost to preserve', () => {
    // A first-ever cost needs no opening entry: the entry the change itself writes is the
    // opening entry.
    expect(openingEntryFrom(null, false, recordedAt)).toBeNull()
    expect(openingEntryFrom(null, true, recordedAt)).toBeNull()
  })

  it('returns null when the previous cost cannot be dated, rather than inventing a time', () => {
    // A fabricated effectiveFrom would claim knowledge the system never had.
    expect(openingEntryFrom(200, false, null)).toBeNull()
  })

  it('preserves a zero cost, which is a real recorded value', () => {
    expect(openingEntryFrom(0, false, recordedAt)).toEqual({ cost: 0, effectiveFrom: recordedAt })
  })
})
