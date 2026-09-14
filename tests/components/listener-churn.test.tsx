// @vitest-environment jsdom
/**
 * A Firestore listener must be opened because the *query* changed, never because the
 * component re-rendered.
 *
 * This guards a regression that made every data-driven screen — Dashboard, Orders, Queue,
 * Order detail — permanently slow. The subscription hooks take a message to show if the read
 * fails, and it was in their effect's dependency array. That was harmless while it was a
 * plain string: two renders produced the same primitive, so the effect stayed put. Making the
 * interface translatable turned it into a `Message` object built by `message('load.orders')`,
 * which is a **new object on every render** — so the effect re-ran, closed the listener,
 * opened another, received a snapshot, set state, and re-rendered, forever.
 *
 * Measured on a 60-order day: one mount of `useOrdersWorkspace` issued 395 subscriptions to
 * `orders` and was still going when the harness cut it off, against 1 before the change.
 *
 * The cap below is what lets this test terminate at all. If the loop ever comes back, the
 * mock goes silent after CAP subscriptions and the assertions fail with a real number rather
 * than hanging the suite.
 */
import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const subscribeLog: string[] = []
const CAP = 200
const ORDER_COUNT = 60
const BUSINESS_DATE = '2026-09-14'

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: { __db: true } }))

/**
 * A Firestore stand-in that records every subscription and answers immediately.
 *
 * Answering synchronously is the point: the real SDK serves the local cache within a frame,
 * so a snapshot lands and re-renders the component almost at once. That is exactly the pulse
 * that turned an unstable dependency into a loop.
 */
vi.mock('firebase/firestore', () => {
  const pathOf = (ref: { __kind?: string; base?: unknown; path?: string }): string =>
    ref?.__kind === 'query'
      ? pathOf(ref.base as { __kind?: string; path?: string })
      : (ref?.path ?? 'unknown')

  return {
    collection: (_db: unknown, path: string) => ({ __kind: 'collection', path }),
    doc: (_db: unknown, path: string, id: string) => ({ __kind: 'doc', path: `${path}/${id}` }),
    query: (base: unknown, ...constraints: unknown[]) => ({ __kind: 'query', base, constraints }),
    where: (field: string, op: string, value: unknown) => ({ field, op, value }),
    orderBy: (field: string) => ({ field }),
    onSnapshot: (ref: Parameters<typeof pathOf>[0], next: (snap: unknown) => void) => {
      const path = pathOf(ref)
      subscribeLog.push(path)
      if (subscribeLog.length > CAP) return () => {}

      if (path === 'orders') {
        next({
          docs: Array.from({ length: ORDER_COUNT }, (_, index) => ({
            id: `o${index}`,
            data: () => ({
              number: index + 1,
              businessDate: BUSINESS_DATE,
              lines: [
                {
                  menuItemId: 'm1',
                  name: 'Flat White',
                  basePrice: 1250,
                  unitPrice: 1250,
                  modifiers: [],
                  quantity: 1,
                },
              ],
              total: 1250,
              orderType: 'takeaway',
              tableNumber: null,
              paymentMethod: null,
              cashTendered: null,
              changeGiven: null,
              createdAt: { toDate: () => new Date('2026-09-14T02:00:00.000Z') },
              createdBy: 'u1',
              createdByName: 'Test User',
              staffId: 's1',
              staffName: 'Alice',
            }),
          })),
        })
      } else {
        next({ docs: [] })
      }
      return () => {}
    },
    getDocs: async () => ({ docs: [] }),
    serverTimestamp: () => ({}),
    Timestamp: { fromDate: (date: Date) => ({ toDate: () => date }) },
  }
})

import { useOrdersWorkspace } from '@/features/pos/useOrdersWorkspace'

function countsByCollection(): Record<string, number> {
  return subscribeLog.reduce<Record<string, number>>(
    (totals, path) => ({ ...totals, [path]: (totals[path] ?? 0) + 1 }),
    {},
  )
}

describe('the orders workspace opens one listener per collection and then stops', () => {
  it('settles on mount instead of resubscribing forever', () => {
    subscribeLog.length = 0

    const { result, unmount } = renderHook(() => useOrdersWorkspace(BUSINESS_DATE))

    // The data actually arrived — otherwise a hook that subscribes to nothing would pass.
    expect(result.current.views).toHaveLength(ORDER_COUNT)
    expect(result.current.loading).toBe(false)

    expect(countsByCollection().orders).toBe(1)
    // Well under the cap: the loop issued hundreds. The sidecars legitimately subscribe
    // twice — once with no orders to describe, once when the day's ids arrive.
    expect(subscribeLog.length).toBeLessThanOrEqual(10)

    unmount()
  })

  it('opens nothing further when the component re-renders for an unrelated reason', () => {
    subscribeLog.length = 0
    const { rerender, unmount } = renderHook(() => useOrdersWorkspace(BUSINESS_DATE))
    const afterMount = subscribeLog.length

    for (let index = 0; index < 10; index += 1) {
      act(() => {
        rerender()
      })
    }

    expect(subscribeLog.length - afterMount).toBe(0)
    unmount()
  })

  it('does open a new listener when the business date changes', () => {
    subscribeLog.length = 0
    const { rerender, unmount } = renderHook(({ date }) => useOrdersWorkspace(date), {
      initialProps: { date: BUSINESS_DATE },
    })
    const afterMount = countsByCollection().orders ?? 0

    act(() => {
      rerender({ date: '2026-09-15' })
    })

    // The whole point of the fix is that this still happens: a different day is a different
    // query, and realtime behaviour for it must not be lost.
    expect(countsByCollection().orders).toBe(afterMount + 1)
    unmount()
  })
})
