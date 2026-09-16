// @vitest-environment jsdom
/**
 * Whether somebody is still on the roster, at a glance.
 *
 * The status column used to be plain text — dark grey for active, lighter grey for
 * inactive — which is not a difference you can see while scanning a list, and is exactly
 * the fault StatusBadge.test.tsx pins for the Orders list. This roster now uses the same
 * badge as the menu and the orders list, so the same rule applies to it: green means on
 * the roster, red means retired, and the word is always there as well for anyone who
 * cannot separate the two hues.
 *
 * Deactivating is still deactivating: these tests assert on appearance only, and the
 * toggle is included so a colour change cannot quietly take the control with it.
 */
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderComponent } from './render'

const state = { staff: [] as unknown[] }

const setStaffActive = vi.fn(async () => {})

vi.mock('@/features/staff/staff-api', () => ({
  createStaffMember: vi.fn(),
  renameStaffMember: vi.fn(),
  setStaffActive: (...args: unknown[]) => setStaffActive(...(args as [])),
}))

vi.mock('@/features/staff/useStaffMembers', () => ({
  useStaffMembers: () => ({ staff: state.staff, loading: false, error: null }),
}))

import { StaffListPage } from '@/features/staff/StaffListPage'

const ALICE = { id: 'staff-1', name: 'Alice', active: true, createdAt: null }
const BRUNO = { id: 'staff-2', name: 'Bruno', active: false, createdAt: null }

function renderRoster(staff: unknown[]) {
  state.staff = staff
  return renderComponent(
    <MemoryRouter>
      <StaffListPage />
    </MemoryRouter>,
  )
}

/** The status cell of the row for this person. */
function statusOf(name: string): HTMLElement {
  const row = screen
    .getAllByTestId('staff-row')
    .find((candidate) => candidate.getAttribute('data-staff-name') === name)
  if (!row) throw new Error(`No row for ${name}`)
  const status = row.querySelector('[data-testid="staff-status"]')
  if (!status) throw new Error(`No status badge for ${name}`)
  return status as HTMLElement
}

beforeEach(() => {
  state.staff = []
  setStaffActive.mockClear()
})

describe('an active staff member reads as active', () => {
  it('is green, and says so', () => {
    renderRoster([ALICE])

    expect(statusOf('Alice').textContent).toBe('Active')
    expect(statusOf('Alice').className).toContain('text-success')
    expect(statusOf('Alice').getAttribute('data-status')).toBe('active')
  })
})

describe('an inactive staff member reads as retired', () => {
  it('is red, and says so', () => {
    renderRoster([BRUNO])

    expect(statusOf('Bruno').textContent).toBe('Inactive')
    expect(statusOf('Bruno').className).toContain('text-destructive')
    expect(statusOf('Bruno').getAttribute('data-status')).toBe('inactive')
  })

  it('never looks like an active one', () => {
    // The regression this replaces: two greys, told apart only by reading the word.
    renderRoster([ALICE, BRUNO])

    expect(statusOf('Bruno').className).not.toBe(statusOf('Alice').className)
    expect(statusOf('Bruno').className).not.toContain('text-success')
    expect(statusOf('Alice').className).not.toContain('text-destructive')
  })
})

describe('the colour is the only thing that changed', () => {
  it('still deactivates the person whose button was pressed', async () => {
    const { user } = renderRoster([ALICE])

    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    expect(setStaffActive).toHaveBeenCalledWith('staff-1', false)
  })

  it('still offers to reactivate somebody who is off the roster', async () => {
    const { user } = renderRoster([BRUNO])

    await user.click(screen.getByRole('button', { name: 'Reactivate' }))

    expect(setStaffActive).toHaveBeenCalledWith('staff-2', true)
  })
})
