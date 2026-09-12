// @vitest-environment jsdom
/**
 * Taking money, driven the way the counter drives it.
 *
 * The arithmetic itself is already proven in tests/unit (`changeDue`, `parsePriceInput`).
 * What was never checked is the wiring: that the number shown as change is the one the
 * arithmetic returned, that an under-payment is stopped at the till rather than at the
 * server, and that e-wallet sends no cash figure at all — the shape the rules insist on.
 */
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RecordPaymentDialog } from '@/features/pos/RecordPaymentDialog'

import { renderComponent } from './render'

const TOTAL = 3190

function setup(
  onConfirm = vi.fn<(method: string, cashTendered: number | null) => Promise<void>>(async () => {}),
) {
  const rendered = renderComponent(
    <RecordPaymentDialog orderNumber={7} total={TOTAL} onConfirm={onConfirm} />,
  )
  return { ...rendered, onConfirm }
}

async function open(user: ReturnType<typeof setup>['user']) {
  await user.click(screen.getByTestId('record-payment'))
}

describe('RecordPaymentDialog: cash', () => {
  it('shows the change as the cash entry is typed', async () => {
    const { user } = setup()
    await open(user)
    await user.type(screen.getByLabelText(/Cash received/), '50')

    // RM 50.00 tendered against RM 31.90 owed.
    expect(screen.getByTestId('payment-change').textContent).toBe('RM 18.10')
  })

  it('shows no change until the entry is usable', async () => {
    const { user } = setup()
    await open(user)
    expect(screen.getByTestId('payment-change').textContent).toBe('—')

    // Below the total: there is no change to show, because there is no valid payment.
    await user.type(screen.getByLabelText(/Cash received/), '10')
    expect(screen.getByTestId('payment-change').textContent).toBe('—')
  })

  it('sends whole sen, not the typed string', async () => {
    const { user, onConfirm } = setup()
    await open(user)
    await user.type(screen.getByLabelText(/Cash received/), '31.90')
    await user.click(screen.getByTestId('confirm-payment'))

    expect(onConfirm).toHaveBeenCalledWith('cash', 3190)
  })

  it('refuses an amount below the total without contacting anything', async () => {
    const { user, onConfirm } = setup()
    await open(user)
    await user.type(screen.getByLabelText(/Cash received/), '20')
    await user.click(screen.getByTestId('confirm-payment'))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('The amount tendered is less than the total.')).not.toBeNull()
  })

  it('refuses an empty or unparseable entry', async () => {
    const { user, onConfirm } = setup()
    await open(user)
    await user.click(screen.getByTestId('confirm-payment'))
    expect(screen.getByText('Enter the amount received.')).not.toBeNull()

    await user.type(screen.getByLabelText(/Cash received/), 'fifty')
    await user.click(screen.getByTestId('confirm-payment'))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('RecordPaymentDialog: e-wallet', () => {
  it('records no cash figure at all', async () => {
    const { user, onConfirm } = setup()
    await open(user)
    await user.click(screen.getByTestId('payment-ewallet'))

    // The cash field is gone, not merely ignored — there is nothing to count out.
    expect(screen.queryByLabelText(/Cash received/)).toBeNull()

    await user.click(screen.getByTestId('confirm-payment'))
    expect(onConfirm).toHaveBeenCalledWith('ewallet', null)
  })

  it('switches back to cash and asks for the amount again', async () => {
    const { user, onConfirm } = setup()
    await open(user)
    await user.click(screen.getByTestId('payment-ewallet'))
    await user.click(screen.getByTestId('payment-cash'))

    await user.click(screen.getByTestId('confirm-payment'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('Enter the amount received.')).not.toBeNull()
  })
})

describe('RecordPaymentDialog: when the write fails', () => {
  it('stays open and shows why, rather than looking as though it worked', async () => {
    const onConfirm = vi.fn<(method: string, cash: number | null) => Promise<void>>(async () => {
      throw new Error('That sale has already been paid.')
    })
    const { user } = setup(onConfirm)
    await open(user)
    await user.click(screen.getByTestId('payment-ewallet'))
    await user.click(screen.getByTestId('confirm-payment'))

    expect(await screen.findByText('That sale has already been paid.')).not.toBeNull()
    expect(screen.getByTestId('confirm-payment')).not.toBeNull()
  })

  it('closes on success', async () => {
    const { user } = setup()
    await open(user)
    await user.click(screen.getByTestId('payment-ewallet'))
    await user.click(screen.getByTestId('confirm-payment'))

    await waitFor(() => expect(screen.queryByTestId('confirm-payment')).toBeNull())
  })

  it('reopens on cash with an empty field, carrying nothing over', async () => {
    const { user } = setup()
    await open(user)
    await user.click(screen.getByTestId('payment-ewallet'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await open(user)

    expect((screen.getByLabelText(/Cash received/) as HTMLInputElement).value).toBe('')
  })
})
