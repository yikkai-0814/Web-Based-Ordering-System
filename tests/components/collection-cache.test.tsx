// @vitest-environment jsdom
/**
 * What a collection shows on the way back to a page that has already been visited.
 *
 * Menu and Staff read their rows through `useCollectionDocs`. Navigating away unmounts the
 * page and tears the listener down, so returning was a fresh mount that began with
 * `loading: true` and no rows — which the pages render as a grey skeleton. Measured against
 * the emulator, the replacement data arrives from Firestore's local cache in 10-25 ms: long
 * enough to see the flash, far too short for it to carry any meaning.
 *
 * Remembering what the collection last reported removes the flash. What these tests pin down
 * is the part that is easy to get wrong: remembering must not become trusting. The listener is
 * still created and its snapshot still wins, a collection nobody has opened still waits, and a
 * failed read is never remembered.
 */
import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SnapshotHandler = (snapshot: { docs: { id: string; data: () => object }[] }) => void
type ErrorHandler = () => void

/** Live listeners, keyed by collection path, so a test can deliver a snapshot by hand. */
const listeners = new Map<string, { next: SnapshotHandler; fail: ErrorHandler }>()
let subscribeCount = 0
let unsubscribeCount = 0

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: { __db: true } }))

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ __kind: 'collection', path }),
  onSnapshot: (ref: { path: string }, next: SnapshotHandler, fail: ErrorHandler) => {
    subscribeCount += 1
    listeners.set(ref.path, { next, fail })
    return () => {
      unsubscribeCount += 1
      listeners.delete(ref.path)
    }
  },
}))

import { clearCollectionCache, useCollectionDocs } from '@/features/menu/use-collection'

interface Row {
  id: string
  name: string
}

/** Module-level, as the hook's contract requires. */
function parseRow(id: string, data: Record<string, unknown>): Row | null {
  return typeof data.name === 'string' ? { id, name: data.name } : null
}

function deliver(path: string, names: string[]) {
  const listener = listeners.get(path)
  if (!listener) throw new Error(`no listener on ${path}`)
  act(() => {
    listener.next({
      docs: names.map((name, index) => ({ id: `d${index}`, data: () => ({ name }) })),
    })
  })
}

function failRead(path: string) {
  const listener = listeners.get(path)
  if (!listener) throw new Error(`no listener on ${path}`)
  act(() => listener.fail())
}

beforeEach(() => {
  clearCollectionCache()
  listeners.clear()
  subscribeCount = 0
  unsubscribeCount = 0
})

afterEach(() => {
  clearCollectionCache()
})

describe('a collection is remembered between visits', () => {
  it('waits, with no rows, the first time a collection is opened', () => {
    const view = renderHook(() => useCollectionDocs('menuItems', parseRow))

    expect(view.result.current.loading).toBe(true)
    expect(view.result.current.data).toEqual([])
    view.unmount()
  })

  it('shows the previous rows immediately on the next visit, with no loading state', () => {
    const first = renderHook(() => useCollectionDocs('menuItems', parseRow))
    deliver('menuItems', ['Flat White', 'Latte'])
    expect(first.result.current.loading).toBe(false)
    first.unmount()
    expect(unsubscribeCount).toBe(1)

    // Navigating back: this is the grey flash, and it must not happen.
    const second = renderHook(() => useCollectionDocs('menuItems', parseRow))
    expect(second.result.current.loading).toBe(false)
    expect(second.result.current.data.map((row) => row.name)).toEqual(['Flat White', 'Latte'])
    second.unmount()
  })

  it('still creates the listener, and the snapshot still wins', () => {
    const first = renderHook(() => useCollectionDocs('menuItems', parseRow))
    deliver('menuItems', ['Flat White'])
    first.unmount()

    const before = subscribeCount
    const second = renderHook(() => useCollectionDocs('menuItems', parseRow))
    // Remembering is not a substitute for subscribing: realtime behaviour is unchanged.
    expect(subscribeCount).toBe(before + 1)
    expect(second.result.current.data.map((row) => row.name)).toEqual(['Flat White'])

    // Whatever the server actually says replaces what was remembered.
    deliver('menuItems', ['Flat White', 'Cortado'])
    expect(second.result.current.data.map((row) => row.name)).toEqual(['Flat White', 'Cortado'])
    second.unmount()
  })

  it('keeps collections apart', () => {
    const menu = renderHook(() => useCollectionDocs('menuItems', parseRow))
    deliver('menuItems', ['Flat White'])
    menu.unmount()

    // A different collection has nothing remembered and must wait rather than borrow.
    const staff = renderHook(() => useCollectionDocs('staffMembers', parseRow))
    expect(staff.result.current.loading).toBe(true)
    expect(staff.result.current.data).toEqual([])
    staff.unmount()
  })

  it('does not remember a failed read', () => {
    const failed = renderHook(() => useCollectionDocs('menuItems', parseRow))
    failRead('menuItems')
    expect(failed.result.current.error).not.toBeNull()
    expect(failed.result.current.data).toEqual([])
    failed.unmount()

    // The next visit retries from scratch rather than inheriting the error or empty rows.
    const retried = renderHook(() => useCollectionDocs('menuItems', parseRow))
    expect(retried.result.current.loading).toBe(true)
    expect(retried.result.current.error).toBeNull()
    retried.unmount()
  })

  it('never seeds a collection the caller is not allowed to read', () => {
    const admin = renderHook(() => useCollectionDocs('menuItemCosts', parseRow, true))
    deliver('menuItemCosts', ['cost row'])
    admin.unmount()

    // A staff session passes enabled: false. It must see the disabled state, not the rows an
    // admin session happened to leave behind in this tab.
    const staff = renderHook(() => useCollectionDocs('menuItemCosts', parseRow, false))
    expect(staff.result.current.data).toEqual([])
    expect(staff.result.current.loading).toBe(false)
    staff.unmount()
  })
})
