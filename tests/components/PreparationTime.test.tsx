// @vitest-environment jsdom
/**
 * The preparation timer on an order card.
 *
 * The arithmetic is proven exhaustively in tests/unit. What is proven here is the thing unit
 * tests cannot see: that the number on screen starts as soon as the order exists, keeps
 * moving while nothing else happens to it, stops when it is marked ready, and is labelled.
 *
 * Fake timers throughout — a test that waited a real second per assertion would be a test
 * nobody runs.
 */
import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PreparationTime } from '@/features/pos/PreparationTime'

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
 * Testing Library called, so nothing else would flush it and the DOM would still show the
 * previous second.
 */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const duration = () => screen.getByTestId('preparation-duration').textContent
const running = () => screen.getByTestId('preparation-time').getAttribute('data-running')

describe('the timer starts with the order, not with the kitchen', () => {
  it('is already running on a brand-new order with no fulfilment record', () => {
    renderComponent(<PreparationTime order={order} fulfillment={null} />)
    expect(duration()).toBe('0:00')
    expect(running()).toBe('true')
  })

  it('counts up while the order sits pending and unpaid', async () => {
    renderComponent(<PreparationTime order={order} fulfillment={null} />)

    await tick(1_000)
    expect(duration()).toBe('0:01')

    await tick(59_000)
    expect(duration()).toBe('1:00')
  })

  it('keeps the same start once preparation begins', async () => {
    // The sidecar now exists and has no finish. Nothing about the number changes.
    const { rerender } = renderComponent(<PreparationTime order={order} fulfillment={null} />)
    await tick(120_000)
    expect(duration()).toBe('2:00')

    rerender(<PreparationTime order={order} fulfillment={{ readyAt: null }} />)
    expect(duration()).toBe('2:00')

    await tick(30_000)
    expect(duration()).toBe('2:30')
  })

  it('labels the number, so it cannot be read as something else', () => {
    renderComponent(<PreparationTime order={order} fulfillment={null} />)
    expect(screen.getByTestId('preparation-time').textContent).toContain('Prep time')
  })

  it('shows nothing until the order has a resolved creation time', () => {
    renderComponent(<PreparationTime order={{ createdAt: null }} fulfillment={null} />)
    expect(screen.queryByTestId('preparation-time')).toBeNull()
  })

  it('stops ticking once unmounted, leaving no interval behind', async () => {
    const { unmount } = renderComponent(<PreparationTime order={order} fulfillment={null} />)
    unmount()
    await tick(5_000)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('payment does not touch the timer', () => {
  it('keeps counting across a payment, which it never sees', async () => {
    // The component is not given payment at all — this asserts the shape of the contract as
    // much as the behaviour. Paying an order re-renders the card; the number must not care.
    const { rerender } = renderComponent(<PreparationTime order={order} fulfillment={null} />)
    await tick(300_000)
    expect(duration()).toBe('5:00')

    // 7:35 PM: the customer pays. Same order, same fulfilment, one more render.
    rerender(<PreparationTime order={order} fulfillment={null} />)
    expect(duration()).toBe('5:00')

    await tick(60_000)
    expect(duration()).toBe('6:00')
  })
})

describe('a finished order', () => {
  // Created 7:30:00 PM, ready 7:42:30 PM — the requirement's worked example.
  const ready = { readyAt: at(new Date('2026-09-13T19:42:30.000Z')) }

  it('stops at readyAt minus createdAt, ignoring when payment happened', () => {
    renderComponent(<PreparationTime order={order} fulfillment={ready} />)
    expect(duration()).toBe('12:30')
    expect(running()).toBe('false')
  })

  it('does not move, however long the order then sits there', async () => {
    renderComponent(<PreparationTime order={order} fulfillment={ready} />)
    await tick(600_000)
    expect(duration()).toBe('12:30')
  })

  it('keeps the same duration after delivery, which changes neither timestamp', () => {
    renderComponent(<PreparationTime order={order} fulfillment={ready} />)
    expect(duration()).toBe('12:30')
  })

  it('runs again from the original start if ready is corrected back to preparing', async () => {
    const { rerender } = renderComponent(<PreparationTime order={order} fulfillment={ready} />)
    expect(duration()).toBe('12:30')

    // The correction clears readyAt. createdAt never moved, so the clock resumes counting
    // the order's whole life rather than starting a second stopwatch: a minute after it was
    // marked ready, the number is 13:30, not one minute.
    await tick(810_000)
    rerender(<PreparationTime order={order} fulfillment={{ readyAt: null }} />)
    expect(duration()).toBe('13:30')
    expect(running()).toBe('true')
  })
})
