// @vitest-environment jsdom
/**
 * The void dialog, driven the way a person drives it.
 *
 * This is the interaction with the most hidden state in the app — two steps, a role that
 * decides whether the second one exists, and a password that must never survive a failure —
 * and until this suite existed, none of it was checked by anything but a human clicking.
 *
 * The component holds no Firestore: it takes an `onConfirm` and reports what it collected.
 * So these tests assert on exactly that boundary, which is also the boundary Phase 11's
 * security rests on — a staff member reaches `onConfirm` only WITH credentials attached.
 */
import { message, MessageError } from '@/features/i18n/messages'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { VoidOrderDialog } from '@/features/pos/VoidOrderDialog'

import { renderComponent } from './render'

/** The value of an input, by test id. Stands in for jest-dom's `toHaveValue`. */
function valueOf(testId: string): string {
  return (screen.getByTestId(testId) as HTMLInputElement).value
}

const ORDER_NUMBER = 42
const AMOUNT = 3190

function setup(
  requiresAuthorization: boolean,
  onConfirm = vi.fn<(reason: string, credentials: unknown) => Promise<void>>(async () => {}),
) {
  const rendered = renderComponent(
    <VoidOrderDialog
      orderNumber={ORDER_NUMBER}
      amount={AMOUNT}
      requiresAuthorization={requiresAuthorization}
      onConfirm={onConfirm}
    />,
  )
  return { ...rendered, onConfirm }
}

/** Opens the dialog and fills the reason in — the part both roles share. */
async function openAndGiveReason(
  user: ReturnType<typeof setup>['user'],
  reason = 'Wrong item rung up',
) {
  await user.click(screen.getByTestId('void-order'))
  await user.type(screen.getByLabelText('Reason'), reason)
}

describe('VoidOrderDialog: an admin voids in one step', () => {
  it('collects the reason and confirms without asking for anything else', async () => {
    const { user, onConfirm } = setup(false)
    await openAndGiveReason(user)
    await user.click(screen.getByTestId('confirm-void'))

    // Null credentials is the signal that this is the admin's own session doing the write.
    expect(onConfirm).toHaveBeenCalledWith('Wrong item rung up', null)
    expect(screen.queryByTestId('manager-email')).toBeNull()
  })

  it('trims the reason before handing it over', async () => {
    const { user, onConfirm } = setup(false)
    await openAndGiveReason(user, '   Spilled   ')
    await user.click(screen.getByTestId('confirm-void'))

    expect(onConfirm).toHaveBeenCalledWith('Spilled', null)
  })

  it('closes once the void succeeds', async () => {
    const { user } = setup(false)
    await openAndGiveReason(user)
    await user.click(screen.getByTestId('confirm-void'))

    await waitFor(() => expect(screen.queryByTestId('confirm-void')).toBeNull())
  })
})

describe('VoidOrderDialog: staff must produce a manager', () => {
  it('asks for credentials instead of voiding, and only then calls onConfirm', async () => {
    const { user, onConfirm } = setup(true)
    await openAndGiveReason(user)

    await user.click(screen.getByTestId('continue-void'))
    // Nothing has been voided yet — the reason step alone is not an authorisation.
    expect(onConfirm).not.toHaveBeenCalled()

    await user.type(screen.getByTestId('manager-email'), 'ada@example.com')
    await user.type(screen.getByTestId('manager-password'), 'hunter2')
    await user.click(screen.getByTestId('confirm-void'))

    expect(onConfirm).toHaveBeenCalledWith('Wrong item rung up', {
      email: 'ada@example.com',
      password: 'hunter2',
    })
  })

  it('never offers a way past the authorisation step', async () => {
    // The staff-facing dialog must not expose a control that submits without credentials:
    // that would be the whole control implemented as an honour system.
    const { user, onConfirm } = setup(true)
    await openAndGiveReason(user)
    expect(screen.queryByTestId('confirm-void')).toBeNull()

    await user.click(screen.getByTestId('continue-void'))
    await user.click(screen.getByTestId('confirm-void'))

    // Clicked with both fields empty: refused here, nothing attempted.
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText("Enter the manager's email address.")).not.toBeNull()
  })

  it('refuses an empty password once the email is filled in', async () => {
    const { user, onConfirm } = setup(true)
    await openAndGiveReason(user)
    await user.click(screen.getByTestId('continue-void'))
    await user.type(screen.getByTestId('manager-email'), 'ada@example.com')
    await user.click(screen.getByTestId('confirm-void'))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText("Enter the manager's password.")).not.toBeNull()
  })
})

describe('VoidOrderDialog: the reason is required before anything else', () => {
  it('refuses to advance an empty reason, for either role', async () => {
    const { user, onConfirm } = setup(true)
    await user.click(screen.getByTestId('void-order'))
    await user.click(screen.getByTestId('continue-void'))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByTestId('manager-email')).toBeNull()
    expect(screen.getByText('Enter a reason for voiding this sale.')).not.toBeNull()
  })

  it('refuses a reason of nothing but spaces', async () => {
    const { user, onConfirm } = setup(false)
    await openAndGiveReason(user, '    ')
    await user.click(screen.getByTestId('confirm-void'))

    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('VoidOrderDialog: a refused authorisation', () => {
  // What withManagerAuthorization actually throws now: a message the dialog translates.
  const REFUSED = 'Those credentials are not allowed to authorise this. Ask an administrator.'

  async function refuseOnce() {
    const onConfirm = vi.fn<(reason: string, credentials: unknown) => Promise<void>>(async () => {
      throw new MessageError(message('void.notAManager'))
    })
    const { user } = setup(true, onConfirm)
    await openAndGiveReason(user)
    await user.click(screen.getByTestId('continue-void'))
    await user.type(screen.getByTestId('manager-email'), 'sam@example.com')
    await user.type(screen.getByTestId('manager-password'), 'wrong')
    await user.click(screen.getByTestId('confirm-void'))
    return { user, onConfirm }
  }

  it('stays open and shows why, rather than closing on a failure', async () => {
    await refuseOnce()
    expect(await screen.findByText(REFUSED)).not.toBeNull()
    expect(screen.getByTestId('confirm-void')).not.toBeNull()
  })

  it('clears the password but keeps the reason, so only the secret is retyped', async () => {
    await refuseOnce()
    await screen.findByText(REFUSED)

    expect(valueOf('manager-password')).toBe('')
    // The email stays too: it is not a secret, and a manager retyping it every attempt at a
    // busy counter is how people start writing passwords on the wall.
    expect(valueOf('manager-email')).toBe('sam@example.com')
  })

  it('lets a second attempt through with the corrected password', async () => {
    const { user, onConfirm } = await refuseOnce()
    await screen.findByText(REFUSED)
    onConfirm.mockImplementation(async () => {})

    await user.type(screen.getByTestId('manager-password'), 'correct-horse')
    await user.click(screen.getByTestId('confirm-void'))

    expect(onConfirm).toHaveBeenLastCalledWith('Wrong item rung up', {
      email: 'sam@example.com',
      password: 'correct-horse',
    })
  })
})

describe('VoidOrderDialog: nothing survives the dialog closing', () => {
  it('forgets the reason and the credentials when cancelled', async () => {
    const { user } = setup(true)
    await openAndGiveReason(user, 'Customer changed their mind')
    await user.click(screen.getByTestId('continue-void'))
    await user.type(screen.getByTestId('manager-email'), 'ada@example.com')
    await user.type(screen.getByTestId('manager-password'), 'hunter2')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByTestId('void-order'))

    // Reopened at step one with empty fields: a half-finished void on a shared till must not
    // be inherited by whoever picks the screen up next.
    expect((screen.getByLabelText('Reason') as HTMLInputElement).value).toBe('')
    expect(screen.queryByTestId('manager-password')).toBeNull()
  })
})
