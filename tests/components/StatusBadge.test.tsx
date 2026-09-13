// @vitest-environment jsdom
/**
 * What each status looks like.
 *
 * These are appearance assertions, which are usually not worth writing — but one of them is
 * the bug this refinement fixed. `completed` and `pending` were rendered in the same grey,
 * so the one comparison the Orders list exists to make ("is this finished?") could not be
 * made without reading the word. The test that would have caught that is the test that
 * belongs here.
 *
 * Colour is never the only signal: every badge still carries its word, and that is asserted
 * alongside the tone rather than instead of it.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  FulfillmentStatusBadge,
  OverallStatusBadge,
  PaymentStatusBadge,
} from '@/features/pos/PaymentStatusBadge'
import type { PaymentState } from '@/features/pos/payments'

import { renderComponent } from './render'

const overall = () => screen.getByTestId('overall-status')

describe('a completed order reads as complete', () => {
  it('is green, and says so', () => {
    renderComponent(<OverallStatusBadge status="completed" />)
    expect(overall().textContent).toBe('Completed')
    expect(overall().className).toContain('text-success')
  })

  it('does not look like an order nobody has touched', () => {
    // The regression: both were `bg-muted text-muted-foreground`.
    const { unmount } = renderComponent(<OverallStatusBadge status="completed" />)
    const completed = overall().className
    unmount()

    renderComponent(<OverallStatusBadge status="pending" />)
    expect(overall().className).not.toBe(completed)
    expect(overall().className).not.toContain('text-success')
  })

  it('does not look like an order still being worked on', () => {
    const { unmount } = renderComponent(<OverallStatusBadge status="completed" />)
    const completed = overall().className
    unmount()

    renderComponent(<OverallStatusBadge status="preparing" />)
    expect(overall().className).not.toBe(completed)
  })
})

describe('the states that need somebody to act stay red', () => {
  it('keeps voided on the destructive treatment', () => {
    renderComponent(<OverallStatusBadge status="voided" />)
    expect(overall().textContent).toBe('Voided')
    expect(overall().className).toContain('text-destructive')
  })

  it('keeps an unpaid delivered order red, never green', () => {
    // The state the whole workflow exists to make visible: it must not read as "done".
    renderComponent(<OverallStatusBadge status="payment-outstanding" />)
    expect(overall().className).toContain('text-destructive')
    expect(overall().className).not.toContain('text-success')
  })
})

describe('the other two axes keep the same vocabulary', () => {
  it('shows a paid order in the same green as a completed one', () => {
    const paid = { status: 'paid', method: 'cash' } as PaymentState
    renderComponent(<PaymentStatusBadge state={paid} />)
    expect(screen.getByTestId('payment-status').className).toContain('text-success')
  })

  it('keeps an unpaid order red', () => {
    const unpaid = { status: 'unpaid' } as PaymentState
    renderComponent(<PaymentStatusBadge state={unpaid} />)
    expect(screen.getByTestId('payment-status').className).toContain('text-destructive')
  })

  it('shows a delivered order in green and a pending one in neither colour', () => {
    const { unmount } = renderComponent(<FulfillmentStatusBadge status="delivered" />)
    expect(screen.getByTestId('fulfillment-status').className).toContain('text-success')
    unmount()

    renderComponent(<FulfillmentStatusBadge status="pending" />)
    const pending = screen.getByTestId('fulfillment-status').className
    expect(pending).not.toContain('text-success')
    expect(pending).not.toContain('text-destructive')
  })
})
