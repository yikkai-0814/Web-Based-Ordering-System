// @vitest-environment jsdom
/**
 * The two hooks that exist for performance reasons, and the promises they make.
 *
 * Both were written against measurements on a seeded 250-order day: the queue board held one
 * `setInterval` per waiting card, and the Orders list mounted a table row AND a mobile card
 * for every order, hiding one with CSS. Neither is visible in the UI, so neither would be
 * noticed breaking — which is what these tests are for.
 */
import { render, renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNow } from '@/lib/useNow'
import { MD_BREAKPOINT, useMediaQuery } from '@/lib/useMediaQuery'

describe('useNow shares one timer across every subscriber', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function Ticker() {
    useNow(1000)
    return null
  }

  it('opens a single interval however many components are counting', () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval')

    // A busy lunch: seventy-odd cards, all waiting, all ticking.
    const view = render(
      <>
        {Array.from({ length: 72 }, (_, i) => (
          <Ticker key={i} />
        ))}
      </>,
    )

    expect(setInterval).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('gives every subscriber the same instant, so two cards cannot disagree', () => {
    const first = renderHook(() => useNow(1000))
    const second = renderHook(() => useNow(1000))

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(first.result.current).toBe(second.result.current)
    first.unmount()
    second.unmount()
  })

  it('keeps ticking while any subscriber remains', () => {
    const first = renderHook(() => useNow(1000))
    const second = renderHook(() => useNow(1000))
    const before = second.result.current

    first.unmount()
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(second.result.current).toBeGreaterThan(before)
    second.unmount()
  })

  it('stops the timer when the last subscriber goes, leaving nothing running', () => {
    const clearInterval = vi.spyOn(globalThis, 'clearInterval')
    const first = renderHook(() => useNow(1000))
    const second = renderHook(() => useNow(1000))

    first.unmount()
    expect(clearInterval).not.toHaveBeenCalled()

    second.unmount()
    expect(clearInterval).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not make a 5-second caller share a 1-second timer', () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    const fast = renderHook(() => useNow(1000))
    const slow = renderHook(() => useNow(5000))

    expect(setInterval).toHaveBeenCalledTimes(2)
    fast.unmount()
    slow.unmount()
  })
})

describe('useMediaQuery decides which layout to mount', () => {
  let listeners: Array<() => void> = []
  let matches = false

  function install() {
    listeners = []
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          get matches() {
            return matches
          },
          media: query,
          addEventListener: (_: string, l: () => void) => listeners.push(l),
          removeEventListener: (_: string, l: () => void) => {
            listeners = listeners.filter((c) => c !== l)
          },
        }) as unknown as MediaQueryList,
    )
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    matches = false
  })

  it('reports what the query currently says', () => {
    matches = true
    install()
    const { result } = renderHook(() => useMediaQuery(MD_BREAKPOINT))
    expect(result.current).toBe(true)
  })

  it('follows the viewport when it changes', () => {
    matches = false
    install()
    const { result } = renderHook(() => useMediaQuery(MD_BREAKPOINT))
    expect(result.current).toBe(false)

    act(() => {
      matches = true
      for (const l of [...listeners]) l()
    })

    expect(result.current).toBe(true)
  })

  it('lets go of its listener on unmount', () => {
    install()
    const { unmount } = renderHook(() => useMediaQuery(MD_BREAKPOINT))
    expect(listeners).toHaveLength(1)
    unmount()
    expect(listeners).toHaveLength(0)
  })

  it('assumes the wide layout where matchMedia does not exist', () => {
    // jsdom has none by default, and a test that renders the Orders list should get the
    // table rather than neither layout.
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useMediaQuery(MD_BREAKPOINT))
    expect(result.current).toBe(true)
  })
})
