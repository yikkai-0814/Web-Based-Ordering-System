import { describe, expect, it } from 'vitest'

import { operatorNameOf } from '@/features/pos/types'
import { buildOperators, resolveOperator } from '@/features/staff/staff-session'
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
