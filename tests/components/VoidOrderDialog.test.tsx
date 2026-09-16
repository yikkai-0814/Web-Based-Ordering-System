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
import { VOID_REASON_OTHER, VOID_REASON_PRESETS } from '@/features/pos/voids'

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

/** Opens the dialog and picks one of the quick reasons. */
async function openAndSelectReason(
  user: ReturnType<typeof setup>['user'],
  presetId = 'wrong-item',
) {
  await user.click(screen.getByTestId('void-order'))
  await user.selectOptions(screen.getByTestId('void-reason'), presetId)
}

/**
 * Opens the dialog and types a reason of its own under "Other" — the free-text path the
 * dialog has always had, which every test written before the quick reasons existed drives.
 */
async function openAndGiveReason(
  user: ReturnType<typeof setup>['user'],
  reason = 'Wrong item rung up',
) {
  await openAndSelectReason(user, VOID_REASON_OTHER)
  await user.type(screen.getByTestId('void-reason-custom'), reason)
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
  it('refuses to advance with no reason chosen, for either role', async () => {
    const { user, onConfirm } = setup(true)
    await user.click(screen.getByTestId('void-order'))
    await user.click(screen.getByTestId('continue-void'))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByTestId('manager-email')).toBeNull()
    expect(screen.getByText('Select a reason for voiding this sale.')).not.toBeNull()
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

    // Reopened at step one with nothing chosen: a half-finished void on a shared till must
    // not be inherited by whoever picks the screen up next.
    expect((screen.getByTestId('void-reason') as HTMLSelectElement).value).toBe('')
    // And the sentence typed under "Other" is gone with the choice that revealed the field.
    expect(screen.queryByTestId('void-reason-custom')).toBeNull()
    expect(screen.queryByTestId('manager-password')).toBeNull()
  })
})

describe('VoidOrderDialog: the quick reasons', () => {
  it('offers every predefined reason, plus Other, with nothing chosen to begin with', async () => {
    const { user } = setup(false)
    await user.click(screen.getByTestId('void-order'))

    const select = screen.getByTestId('void-reason') as HTMLSelectElement
    expect(select.value).toBe('')
    expect([...select.options].map((option) => option.value)).toEqual([
      '',
      ...VOID_REASON_PRESETS.map((preset) => preset.id),
      VOID_REASON_OTHER,
    ])
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Select a reason',
      'Customer changed mind',
      'Wrong order',
      'Wrong item',
      'Duplicate order',
      'Payment issue',
      'Item unavailable',
      'Staff mistake',
      'Other',
    ])
  })

  it.each(VOID_REASON_PRESETS.map((preset) => preset.id))(
    'lets %s be chosen and voids on that reason alone',
    async (presetId) => {
      const { user, onConfirm } = setup(false)
      await openAndSelectReason(user, presetId)

      // No typing anywhere: the whole point is that the common case is one tap.
      expect(screen.queryByTestId('void-reason-custom')).toBeNull()
      await user.click(screen.getByTestId('confirm-void'))

      const [reason, credentials] = onConfirm.mock.calls[0] as [string, unknown]
      expect(reason.length).toBeGreaterThan(0)
      expect(credentials).toBeNull()
    },
  )

  it('hands over the label the operator read', async () => {
    const { user, onConfirm } = setup(false)
    await openAndSelectReason(user, 'customer-changed-mind')
    await user.click(screen.getByTestId('confirm-void'))

    expect(onConfirm).toHaveBeenCalledWith('Customer changed mind', null)
  })

  it('carries a chosen reason through the manager step unchanged', async () => {
    const { user, onConfirm } = setup(true)
    await openAndSelectReason(user, 'duplicate-order')
    await user.click(screen.getByTestId('continue-void'))
    await user.type(screen.getByTestId('manager-email'), 'ada@example.com')
    await user.type(screen.getByTestId('manager-password'), 'hunter2')
    await user.click(screen.getByTestId('confirm-void'))

    expect(onConfirm).toHaveBeenCalledWith('Duplicate order', {
      email: 'ada@example.com',
      password: 'hunter2',
    })
  })
})

describe('VoidOrderDialog: Other still wants words', () => {
  it('asks for a reason only once Other is chosen', async () => {
    const { user } = setup(false)
    await user.click(screen.getByTestId('void-order'))
    expect(screen.queryByTestId('void-reason-custom')).toBeNull()

    await user.selectOptions(screen.getByTestId('void-reason'), VOID_REASON_OTHER)
    expect(screen.getByTestId('void-reason-custom')).not.toBeNull()
    expect(screen.getByLabelText('Your reason')).not.toBeNull()
  })

  it('refuses to void on Other with nothing typed', async () => {
    const { user, onConfirm } = setup(false)
    await openAndSelectReason(user, VOID_REASON_OTHER)
    await user.click(screen.getByTestId('confirm-void'))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a reason for voiding this sale.')).not.toBeNull()
  })

  it('stores what was typed, trimmed, once there is something to store', async () => {
    const { user, onConfirm } = setup(false)
    await openAndGiveReason(user, '  Tray dropped on the way out  ')
    await user.click(screen.getByTestId('confirm-void'))

    expect(onConfirm).toHaveBeenCalledWith('Tray dropped on the way out', null)
  })

  it('writes the preset, not the abandoned sentence, if the choice changes back', async () => {
    const { user, onConfirm } = setup(false)
    await openAndGiveReason(user, 'Half a thought')
    await user.selectOptions(screen.getByTestId('void-reason'), 'staff-mistake')

    expect(screen.queryByTestId('void-reason-custom')).toBeNull()
    await user.click(screen.getByTestId('confirm-void'))
    expect(onConfirm).toHaveBeenCalledWith('Staff mistake', null)
  })
})
