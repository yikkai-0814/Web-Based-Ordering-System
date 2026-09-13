// @vitest-environment jsdom
/**
 * The elapsed-time readout on an order card.
 *
 * The arithmetic is proven exhaustively in tests/unit. What is proven here is the thing unit
 * tests cannot see: that the number on screen starts as soon as the order exists, keeps
 * moving through every state short of delivery — including `ready` — stops when the order is
 * handed over, and says what it is to a screen reader.
 *
 * Fake timers throughout — a test that waited a real second per assertion would be a test
 * nobody runs.
 */
import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OrderElapsedTime } from '@/features/pos/OrderElapsedTime'

import { renderComponent } from './render'

/** A stand-in for a Firestore Timestamp: the component only ever calls toDate(). */
const at = (date: Date) => ({ toDate: () => date })

/** 7:30:00 PM, the worked example from the requirement. */
const CREATED = new Date('2026-09-13T19:30:00.000Z')

const order = { createdAt: at(CREATED) }

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  vi.setSystemTime(CREATED)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Advances the fake clock and lets the re-render it causes flush.
 *
 * Wrapped in `act` because this update originates in an interval rather than in anything
 * Testing Library called, so nothing else would flush it.
 */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const duration = () => screen.getByTestId('order-elapsed-duration').textContent
const running = () => screen.getByTestId('order-elapsed').getAttribute('data-running')
const label = () => screen.getByTestId('order-elapsed').getAttribute('aria-label')

describe('the clock starts with the order', () => {
  it('is already running on a brand-new order with no fulfilment record', () => {
    renderComponent(<OrderElapsedTime order={order} fulfillment={null} />)
    expect(duration()).toBe('0:00')
    expect(running()).toBe('true')
  })

  it('counts up while the order sits pending and unpaid', async () => {
    renderComponent(<OrderElapsedTime order={order} fulfillment={null} />)

    await tick(1_000)
    expect(duration()).toBe('0:01')

    await tick(203_000)
    expect(duration()).toBe('3:24')
  })

  it('says what the number is, for anyone who cannot see the clock icon', () => {
    renderComponent(<OrderElapsedTime order={order} fulfillment={null} />)
    expect(label()).toBe('Time since ordered')
  })

  it('shows nothing until the order has a resolved creation time', () => {
    renderComponent(<OrderElapsedTime order={{ createdAt: null }} fulfillment={null} />)
    expect(screen.queryByTestId('order-elapsed')).toBeNull()
  })

  it('stops ticking once unmounted, leaving no interval behind', async () => {
    const { unmount } = renderComponent(<OrderElapsedTime order={order} fulfillment={null} />)
    unmount()
    await tick(5_000)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('nothing short of delivery stops it', () => {
  it('keeps running when preparation starts', async () => {
    const { rerender } = renderComponent(<OrderElapsedTime order={order} fulfillment={null} />)
    await tick(204_000)
    expect(duration()).toBe('3:24')

    rerender(<OrderElapsedTime order={order} fulfillment={{ deliveredAt: null }} />)
    await tick(113_000)
    expect(duration()).toBe('5:17')
    expect(running()).toBe('true')
  })

  it('KEEPS RUNNING once the order is ready', async () => {
    // The whole point of this change. readyAt is set; the customer still does not have the
    // order, so the wait is still going on.
    const ready = { readyAt: at(new Date('2026-09-13T19:34:00.000Z')), deliveredAt: null }
    const { rerender } = renderComponent(<OrderElapsedTime order={order} fulfillment={ready} />)
    await tick(317_000)
    expect(duration()).toBe('5:17')
    expect(running()).toBe('true')

    rerender(<OrderElapsedTime order={order} fulfillment={ready} />)
    await tick(145_000)
    expect(duration()).toBe('7:42')
    expect(running()).toBe('true')
  })

  it('keeps running across a payment, which it never sees', async () => {
    // The component is not given payment at all — this asserts the shape of the contract as
    // much as the behaviour. Paying re-renders the card; the number must not care.
    const { rerender } = renderComponent(<OrderElapsedTime order={order} fulfillment={null} />)
    await tick(300_000)
    expect(duration()).toBe('5:00')

    rerender(<OrderElapsedTime order={order} fulfillment={null} />)
    expect(duration()).toBe('5:00')

    await tick(60_000)
    expect(duration()).toBe('6:00')
  })
})

describe('delivery stops it, permanently', () => {
  // Created 7:30:00 PM, delivered 7:38:15 PM — the requirement's worked example.
  const delivered = {
    readyAt: at(new Date('2026-09-13T19:34:00.000Z')),
    deliveredAt: at(new Date('2026-09-13T19:38:15.000Z')),
  }

  it('freezes at deliveredAt minus createdAt', () => {
    renderComponent(<OrderElapsedTime order={order} fulfillment={delivered} />)
    expect(duration()).toBe('8:15')
    expect(running()).toBe('false')
    expect(label()).toBe('Total time to delivery')
  })

  it('does not move, however long afterwards the card is looked at', async () => {
    renderComponent(<OrderElapsedTime order={order} fulfillment={delivered} />)
    await tick(600_000)
    expect(duration()).toBe('8:15')
  })

  it('runs again from the original start if delivery is corrected away', async () => {
    const { rerender } = renderComponent(<OrderElapsedTime order={order} fulfillment={delivered} />)
    expect(duration()).toBe('8:15')

    // The correction clears deliveredAt. createdAt never moved, so the clock resumes
    // counting the order's whole life rather than starting a second stopwatch.
    await tick(555_000)
    rerender(<OrderElapsedTime order={order} fulfillment={{ deliveredAt: null }} />)
    expect(duration()).toBe('9:15')
    expect(running()).toBe('true')
  })
})

describe('the prominent form used on the queue board', () => {
  it('renders the same number, at reading size', () => {
    renderComponent(<OrderElapsedTime order={order} fulfillment={null} size="prominent" />)
    const readout = screen.getByTestId('order-elapsed')
    expect(readout.className).toContain('text-base')
    expect(duration()).toBe('0:00')
  })

  it('stays quiet in the compact form', () => {
    renderComponent(<OrderElapsedTime order={order} fulfillment={null} />)
    expect(screen.getByTestId('order-elapsed').className).toContain('text-xs')
  })
})
