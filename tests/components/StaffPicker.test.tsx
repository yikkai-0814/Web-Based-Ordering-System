// @vitest-environment jsdom
/**
 * The screen that stands in front of the till until somebody says who they are.
 *
 * The property worth protecting is that this screen can never become a dead end. A
 * staff-role user cannot create staff identities, so if the roster were the only source of
 * operators, an empty one would stop the stall trading with nobody at the counter able to
 * fix it. The signed-in account is therefore always offered — and that is what this file
 * checks, along with the picker reporting the id it was given rather than a name.
 *
 * The component reads its data from `useStaffSession`, so the context is supplied directly
 * here. No Firestore, no provider, no roster subscription.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { StaffSessionContext, type StaffSessionValue } from '@/features/staff/staff-context'
import { StaffPicker } from '@/features/staff/StaffPicker'
import type { Operator } from '@/features/staff/staff-session'

import { renderComponent } from './render'

const ACCOUNT: Operator = { id: 'till-uid', name: 'Shared Till', isSelf: true }
const ALICE: Operator = { id: 'alice', name: 'Alice', isSelf: false }

function setup({
  operators = [ACCOUNT, ALICE],
  loading = false,
  onSelected = undefined as (() => void) | undefined,
} = {}) {
  const select = vi.fn()
  const value: StaffSessionValue = {
    operator: null,
    operators,
    loading,
    select,
    clear: vi.fn(),
  }
  const rendered = renderComponent(
    <StaffSessionContext value={value}>
      <StaffPicker onSelected={onSelected} />
    </StaffSessionContext>,
  )
  return { ...rendered, select }
}

describe('StaffPicker: who is offered', () => {
  it('lists every operator, the account included', () => {
    setup()
    const names = screen
      .getAllByTestId('staff-option')
      .map((node) => node.getAttribute('data-staff-name'))
    expect(names).toEqual(['Shared Till', 'Alice'])
  })

  it('marks the signed-in account as such', () => {
    setup()
    expect(screen.getByText('This account')).not.toBeNull()
  })

  it('is never empty, even with no roster at all', () => {
    // The dead-end case: nobody has added staff identities yet. Selling must still be
    // possible, so the account's own identity stands alone.
    setup({ operators: [ACCOUNT] })
    expect(screen.getAllByTestId('staff-option')).toHaveLength(1)
  })

  it('says the roster is still arriving, so it does not look complete too early', () => {
    setup({ operators: [ACCOUNT], loading: true })
    expect(screen.getByText('Loading staff…')).not.toBeNull()
  })
})

describe('StaffPicker: choosing', () => {
  it('selects by id, not by the name on the tile', async () => {
    const { user, select } = setup()
    await user.click(screen.getByText('Alice'))
    expect(select).toHaveBeenCalledWith('alice')
  })

  it('tells the caller once a choice is made', async () => {
    const onSelected = vi.fn()
    const { user, select } = setup({ onSelected })
    await user.click(screen.getByText('Shared Till'))

    expect(select).toHaveBeenCalledWith('till-uid')
    expect(onSelected).toHaveBeenCalledOnce()
  })

  it('works without a callback', async () => {
    const { user, select } = setup({ onSelected: undefined })
    await user.click(screen.getByText('Alice'))
    expect(select).toHaveBeenCalledWith('alice')
  })
})
