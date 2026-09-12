// @vitest-environment jsdom
/**
 * Who the till thinks is operating it, across a change of account.
 *
 * The pure rule is proven in tests/unit (`readSelectionFor`). The bug this phase fixed lived
 * in the wiring instead: the provider is mounted above the router and outside the auth guard,
 * so it survives a sign-out, and it used to seed its state from localStorage exactly once. A
 * roster operator chosen by one person therefore carried over to whoever signed in next, and
 * every order, payment, fulfilment step and void they took named the wrong person — in
 * records that are immutable.
 *
 * So this file drives the provider through the sequence that used to be wrong: select, change
 * account, look again.
 *
 * `useAuth` and `useStaffMembers` are stubbed, which is this suite's only use of `vi.mock`.
 * The alternative — a real Firestore listener behind a React render — would test the emulator
 * rather than the wiring.
 */
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserProfile } from '@/features/auth/types'
import { StaffSessionProvider } from '@/features/staff/StaffSessionProvider'
import { STAFF_SESSION_STORAGE_KEY, serializeSelection } from '@/features/staff/staff-session'
import type { StaffMember } from '@/features/staff/types'
import { useStaffSession } from '@/features/staff/useStaffSession'

import { renderComponent } from './render'

const profile = (uid: string, displayName: string): UserProfile => ({
  uid,
  email: `${uid}@example.test`,
  displayName,
  role: 'staff',
  active: true,
  createdAt: null,
})

const ADA = profile('ada-uid', 'Ada')
const BOB = profile('bob-uid', 'Bob')

const ALICE: StaffMember = {
  id: 'alice',
  name: 'Alice',
  active: true,
  createdAt: null,
  updatedAt: null,
}

/** A second name on the roster, so a hand-over can be played out. */
const BOB_ON_ROSTER: StaffMember = {
  id: 'bob',
  name: 'Bob',
  active: true,
  createdAt: null,
  updatedAt: null,
}

/** Swapped between renders to play a sign-out and a different sign-in. */
let currentProfile: UserProfile | null = ADA
let roster: StaffMember[] = [ALICE]

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({ profile: currentProfile }),
}))

vi.mock('@/features/staff/useStaffMembers', () => ({
  useStaffMembers: () => ({ staff: roster, loading: false, error: null }),
}))

/** Shows what the till believes, and offers the one action that changes it. */
function Consumer() {
  const { operator, select } = useStaffSession()
  return (
    <div>
      <span data-testid="operator">{operator ? operator.name : 'nobody'}</span>
      <button type="button" onClick={() => select('alice')}>
        Pick Alice
      </button>
      <button type="button" onClick={() => select('bob')}>
        Pick Bob
      </button>
      <button type="button" onClick={() => select(currentProfile?.uid ?? '')}>
        Pick myself
      </button>
    </div>
  )
}

function renderTill() {
  return renderComponent(
    <StaffSessionProvider>
      <Consumer />
    </StaffSessionProvider>,
  )
}

const operatorName = () => screen.getByTestId('operator').textContent

beforeEach(() => {
  currentProfile = ADA
  roster = [ALICE]
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('StaffSessionProvider: the selection belongs to one account', () => {
  it('asks who is on the till until somebody says', () => {
    renderTill()
    expect(operatorName()).toBe('nobody')
  })

  it('keeps the operator for the account that chose them', async () => {
    const { user } = renderTill()
    await user.click(screen.getByText('Pick Alice'))
    expect(operatorName()).toBe('Alice')
  })

  it('does NOT carry the operator over to a different account', async () => {
    const { user, rerender } = renderTill()
    await user.click(screen.getByText('Pick Alice'))
    expect(operatorName()).toBe('Alice')

    // Ada signs out, Bob signs in on the same till. Alice is still on the roster and still
    // active, so nothing about the operator list stops this — only the uid scoping does.
    currentProfile = BOB
    rerender(
      <StaffSessionProvider>
        <Consumer />
      </StaffSessionProvider>,
    )

    expect(operatorName()).toBe('nobody')
  })

  it('restores the operator on a fresh page load for the same account', async () => {
    const first = renderTill()
    await first.user.click(screen.getByText('Pick Alice'))
    first.unmount()

    // A refresh mid-shift: a new provider, the same account, the same device.
    renderTill()
    expect(operatorName()).toBe('Alice')
  })

  it('gives a returning account its own operator back, not the other one’s', async () => {
    const asAda = renderTill()
    await asAda.user.click(screen.getByText('Pick Alice'))
    asAda.unmount()

    currentProfile = BOB
    const asBob = renderTill()
    expect(operatorName()).toBe('nobody')
    asBob.unmount()

    // Ada is back on the same device. Her own selection is still hers — Bob's session in
    // between neither inherited it nor destroyed it.
    currentProfile = ADA
    renderTill()
    expect(operatorName()).toBe('Alice')
  })
})

describe('StaffSessionProvider: what it refuses to restore', () => {
  it('ignores a selection stored in the pre-Phase-13 format', () => {
    // A bare id, with nothing recording who chose it.
    window.localStorage.setItem(STAFF_SESSION_STORAGE_KEY, 'alice')
    renderTill()
    expect(operatorName()).toBe('nobody')
  })

  it('ignores a selection belonging to somebody else', () => {
    window.localStorage.setItem(STAFF_SESSION_STORAGE_KEY, serializeSelection(BOB.uid, 'alice'))
    renderTill()
    expect(operatorName()).toBe('nobody')
  })

  it('drops an operator who has been deactivated since', async () => {
    const { user, unmount } = renderTill()
    await user.click(screen.getByText('Pick Alice'))
    unmount()

    // Still stored, still this account's — but no longer offered, so the till stops using
    // an identity the rules would now refuse at write time.
    roster = [{ ...ALICE, active: false }]
    renderTill()
    expect(operatorName()).toBe('nobody')
  })
})

describe('StaffSessionProvider: the account as its own operator', () => {
  it('lets somebody operate as themselves, and keeps that too', async () => {
    const { user, unmount } = renderTill()
    await user.click(screen.getByText('Pick myself'))
    expect(operatorName()).toBe('Ada')

    unmount()
    renderTill()
    expect(operatorName()).toBe('Ada')
  })

  it('does not hand a self-selection to the next account', async () => {
    const { user, unmount } = renderTill()
    await user.click(screen.getByText('Pick myself'))
    unmount()

    currentProfile = BOB
    renderTill()
    expect(operatorName()).toBe('nobody')
  })
})

/**
 * Phase 15. The counter picks a name once, not before every order.
 *
 * This is the persistence Phase 13 built, read from the angle the staff workflow cares
 * about: Alice is asked for once and then stays put through a service, and a hand-over is
 * the existing Switch Operator flow rather than a second mechanism. The uid-scoping that
 * makes it safe is unchanged and still covered above.
 */
describe('StaffSessionProvider: one selection lasts a service', () => {
  it('keeps the operator across order after order, without asking again', async () => {
    roster = [ALICE, BOB_ON_ROSTER]
    const { user, unmount } = renderTill()
    await user.click(screen.getByText('Pick Alice'))
    expect(operatorName()).toBe('Alice')
    unmount()

    // Each remount stands for another trip through the New Order page: ring one up, come
    // back for the next. Alice is still there every time, and nobody is asked anything.
    for (let order = 0; order < 3; order += 1) {
      const round = renderTill()
      expect(operatorName()).toBe('Alice')
      round.unmount()
    }
  })

  it('hands over to Bob, and stays handed over', async () => {
    roster = [ALICE, BOB_ON_ROSTER]
    const { user, unmount } = renderTill()
    await user.click(screen.getByText('Pick Alice'))
    await user.click(screen.getByText('Pick Bob'))
    expect(operatorName()).toBe('Bob')
    unmount()

    // The next order is Bob's, not a return to whoever was there first.
    renderTill()
    expect(operatorName()).toBe('Bob')
  })

  it('still refuses to hand either of them to the next account', async () => {
    // The Phase 13 guarantee, restated against a switched operator: a hand-over between two
    // people on one account must not become a hand-over between accounts.
    roster = [ALICE, BOB_ON_ROSTER]
    const { user, unmount } = renderTill()
    await user.click(screen.getByText('Pick Bob'))
    unmount()

    currentProfile = BOB
    renderTill()
    expect(operatorName()).toBe('nobody')
  })
})
