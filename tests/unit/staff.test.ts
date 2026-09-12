import { describe, expect, it } from 'vitest'

import { operatorNameOf } from '@/features/pos/types'
import {
  buildOperators,
  readSelectionFor,
  resolveOperator,
  serializeSelection,
} from '@/features/staff/staff-session'
import {
  parseStaffMember,
  STAFF_NAME_MAX,
  validateStaffName,
  type StaffMember,
} from '@/features/staff/types'

const member = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: 's1',
  name: 'Alice',
  active: true,
  createdAt: null,
  updatedAt: null,
  ...over,
})

describe('parseStaffMember', () => {
  it('accepts a well-formed record', () => {
    const parsed = parseStaffMember('s1', { name: 'Alice', active: true })
    expect(parsed?.name).toBe('Alice')
    expect(parsed?.active).toBe(true)
  })

  it('rejects an empty, whitespace-only or non-string name', () => {
    expect(parseStaffMember('s1', { name: '', active: true })).toBeNull()
    expect(parseStaffMember('s1', { name: '   ', active: true })).toBeNull()
    expect(parseStaffMember('s1', { name: 42, active: true })).toBeNull()
  })

  it('rejects an over-long name', () => {
    expect(
      parseStaffMember('s1', { name: 'x'.repeat(STAFF_NAME_MAX + 1), active: true }),
    ).toBeNull()
    expect(
      parseStaffMember('s1', { name: 'x'.repeat(STAFF_NAME_MAX), active: true }),
    ).not.toBeNull()
  })

  it('rejects a non-boolean active flag rather than guessing', () => {
    expect(parseStaffMember('s1', { name: 'Alice', active: 'yes' })).toBeNull()
    expect(parseStaffMember('s1', { name: 'Alice' })).toBeNull()
  })
})

describe('validateStaffName', () => {
  it('trims and accepts', () => {
    expect(validateStaffName('  Alice  ')).toEqual({ ok: true, name: 'Alice' })
  })

  it('rejects empty and over-long names', () => {
    expect(validateStaffName('').ok).toBe(false)
    expect(validateStaffName('   ').ok).toBe(false)
    expect(validateStaffName('x'.repeat(STAFF_NAME_MAX + 1)).ok).toBe(false)
  })

  it('measures length after trimming', () => {
    expect(validateStaffName(`  ${'x'.repeat(STAFF_NAME_MAX)}  `).ok).toBe(true)
  })
})

describe('buildOperators', () => {
  const self = { uid: 'till-uid', displayName: 'Shared Till' }
  const roster = [
    member({ id: 's1', name: 'Alice' }),
    member({ id: 's2', name: 'Bob', active: false }),
    member({ id: 's3', name: 'Sarah' }),
  ]

  it('always offers the signed-in account first', () => {
    const operators = buildOperators(self, roster)
    expect(operators[0]).toEqual({ id: 'till-uid', name: 'Shared Till', isSelf: true })
  })

  it('ALWAYS offers the account even when the roster is empty', () => {
    // The regression this guards: a staff-role user cannot create staff identities, so an
    // empty roster would otherwise leave them unable to sell with no way to recover.
    const operators = buildOperators(self, [])
    expect(operators).toHaveLength(1)
    expect(operators[0]?.isSelf).toBe(true)
  })

  it('offers the account even when every named identity is deactivated', () => {
    const allInactive = roster.map((entry) => ({ ...entry, active: false }))
    const operators = buildOperators(self, allInactive)
    expect(operators.map((entry) => entry.name)).toEqual(['Shared Till'])
  })

  it('adds active named identities after the account', () => {
    const operators = buildOperators(self, roster)
    expect(operators.map((entry) => entry.name)).toEqual(['Shared Till', 'Alice', 'Sarah'])
    expect(operators.filter((entry) => entry.isSelf)).toHaveLength(1)
  })

  it('never lets a named identity shadow the account entry', () => {
    const clash = [member({ id: 'till-uid', name: 'Impostor' })]
    const operators = buildOperators(self, clash)
    expect(operators).toHaveLength(1)
    expect(operators[0]?.name).toBe('Shared Till')
  })

  it('returns only named identities when there is no signed-in account', () => {
    expect(buildOperators(null, roster).map((entry) => entry.name)).toEqual(['Alice', 'Sarah'])
  })
})

describe('resolveOperator', () => {
  const self = { uid: 'till-uid', displayName: 'Shared Till' }
  const roster = [member({ id: 's1', name: 'Alice' }), member({ id: 's2', name: 'Bob' })]
  const operators = buildOperators(self, roster)

  it('returns the operator when the stored id is offered', () => {
    expect(resolveOperator('s2', operators)?.name).toBe('Bob')
    expect(resolveOperator('till-uid', operators)?.isSelf).toBe(true)
  })

  it('returns null when the stored member was DEACTIVATED', () => {
    const afterDeactivation = buildOperators(self, [
      member({ id: 's1', name: 'Alice' }),
      member({ id: 's2', name: 'Bob', active: false }),
    ])
    expect(resolveOperator('s2', afterDeactivation)).toBeNull()
  })

  it('returns null when the stored member no longer exists', () => {
    expect(resolveOperator('gone', operators)).toBeNull()
  })

  it('returns null for an absent or empty stored value', () => {
    expect(resolveOperator(null, operators)).toBeNull()
    expect(resolveOperator(undefined, operators)).toBeNull()
    expect(resolveOperator('', operators)).toBeNull()
  })

  it('returns null when nothing is on offer', () => {
    expect(resolveOperator('s1', [])).toBeNull()
  })
})

describe('operatorNameOf', () => {
  it('prefers the staff identity that operated the till', () => {
    expect(operatorNameOf({ staffName: 'Alice', createdByName: 'Shared Till' })).toBe('Alice')
  })

  it('falls back to the account name for a pre-Phase-6 order', () => {
    // Orders are immutable, so old orders can never gain a staffName. The fallback is
    // permanent, not transitional.
    expect(operatorNameOf({ staffName: null, createdByName: 'Sam Staff' })).toBe('Sam Staff')
  })

  it('ignores a blank staff name', () => {
    expect(operatorNameOf({ staffName: '   ', createdByName: 'Sam Staff' })).toBe('Sam Staff')
  })

  it('never renders an empty string', () => {
    expect(operatorNameOf({ staffName: null, createdByName: '' })).toBe('Unknown')
    expect(operatorNameOf({ staffName: '  ', createdByName: '   ' })).toBe('Unknown')
  })
})

/**
 * Phase 13. A selection belongs to the account that made it.
 *
 * The bug these cover: the provider is mounted outside the auth guard, so it survives a
 * sign-out. Before this, Alice could be selected, Bob could sign in on the same till, and
 * Bob's sales would be recorded as Alice — permanently, orders being immutable.
 */
describe('readSelectionFor', () => {
  const ADA = 'ada-uid'

  it('gives the operator back to the account that chose them', () => {
    const stored = serializeSelection(ADA, 'alice')
    expect(readSelectionFor(stored, ADA)).toBe('alice')
  })

  it('gives nothing to a different account — the whole point', () => {
    const stored = serializeSelection(ADA, 'alice')
    expect(readSelectionFor(stored, 'bob-uid')).toBeNull()
  })

  it('ignores a selection stored before selections were scoped', () => {
    // The old format was a bare id with nothing recording who chose it. Guessing an owner is
    // exactly the mistake this function exists to prevent, so it costs one re-pick instead.
    expect(readSelectionFor('alice', ADA)).toBeNull()
  })

  it('ignores junk rather than throwing at the counter', () => {
    expect(readSelectionFor('{not json', ADA)).toBeNull()
    expect(readSelectionFor('null', ADA)).toBeNull()
    expect(readSelectionFor('[]', ADA)).toBeNull()
    expect(readSelectionFor('"a string"', ADA)).toBeNull()
    expect(readSelectionFor('42', ADA)).toBeNull()
  })

  it('ignores the right shape with the wrong types', () => {
    expect(readSelectionFor(JSON.stringify({ uid: ADA, operatorId: 7 }), ADA)).toBeNull()
    expect(readSelectionFor(JSON.stringify({ uid: 7, operatorId: 'alice' }), ADA)).toBeNull()
    expect(readSelectionFor(JSON.stringify({ uid: ADA }), ADA)).toBeNull()
    expect(readSelectionFor(JSON.stringify({ operatorId: 'alice' }), ADA)).toBeNull()
  })

  it('ignores an empty operator id', () => {
    expect(readSelectionFor(serializeSelection(ADA, ''), ADA)).toBeNull()
  })

  it('handles nothing stored, and no account signed in', () => {
    expect(readSelectionFor(null, ADA)).toBeNull()
    expect(readSelectionFor(undefined, ADA)).toBeNull()
    expect(readSelectionFor('', ADA)).toBeNull()
    expect(readSelectionFor(serializeSelection(ADA, 'alice'), '')).toBeNull()
  })

  it('round-trips whatever it wrote', () => {
    for (const [uid, operatorId] of [
      [ADA, 'alice'],
      ['uid-with-dashes', 'operator.with.dots'],
      ['uid', 'name with spaces'],
    ] as const) {
      expect(readSelectionFor(serializeSelection(uid, operatorId), uid)).toBe(operatorId)
    }
  })

  it('still lets the account pick ITSELF as operator', () => {
    // The self-identity case: the stored operator id is the account's own uid.
    expect(readSelectionFor(serializeSelection(ADA, ADA), ADA)).toBe(ADA)
  })
})
