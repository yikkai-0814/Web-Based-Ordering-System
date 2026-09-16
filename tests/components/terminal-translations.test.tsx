// @vitest-environment jsdom
/**
 * The till speaks the language of the counter it is standing on.
 *
 * Two things are proven here, and the second is the one that matters months from now. What
 * the person at the counter reads is the item's name in the language this device is set to,
 * falling back to English for an item nobody has translated. And what lands on the order is
 * that same name, copied, so the receipt says what the customer was told — an admin
 * retranslating the item tomorrow cannot reach back and reword a sale that already happened.
 */
import { useSyncExternalStore } from 'react'

import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LANGUAGE_STORAGE_KEY } from '@/features/i18n/languages'
import type { Operator } from '@/features/staff/staff-session'
import { createOrder } from '@/features/pos/pos-api'

import { renderComponent } from './render'

const ALICE: Operator = { id: 'alice', name: 'Alice', isSelf: false }
const ROSTER = [ALICE]

let currentOperator: Operator | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    profile: { uid: 'till-uid', displayName: 'Shared Till', role: 'staff', active: true },
    status: 'authenticated',
    role: 'staff',
  }),
}))

vi.mock('@/features/staff/useStaffSession', () => ({
  useStaffSession: () => ({
    operator: useSyncExternalStore(subscribe, () => currentOperator),
    operators: ROSTER,
    loading: false,
    select: (id: string) => {
      currentOperator = ROSTER.find((candidate) => candidate.id === id) ?? null
      for (const listener of listeners) listener()
    },
  }),
}))

vi.mock('@/features/menu/useCategories', () => ({
  useCategories: () => ({
    categories: [{ id: 'mains', name: 'Mains', sortOrder: 1, active: true }],
    loading: false,
    error: null,
  }),
}))

/** One translated item and one that nobody has translated — the state of a real menu. */
vi.mock('@/features/menu/useMenuItems', () => ({
  useMenuItems: () => ({
    items: [
      {
        id: 'fried-rice',
        name: 'Fried Rice',
        names: { en: 'Fried Rice', ms: 'Nasi Goreng', zh: '炒饭' },
        categoryId: 'mains',
        price: 800,
        sortOrder: 1,
        active: true,
        modifierGroupIds: [],
      },
      {
        id: 'teh-tarik',
        name: 'Teh Tarik',
        names: { en: 'Teh Tarik', ms: '', zh: '' },
        categoryId: 'mains',
        price: 250,
        sortOrder: 2,
        active: true,
        modifierGroupIds: [],
      },
    ],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/features/pos/pos-api', () => ({
  createOrder: vi.fn(),
}))

import { TerminalPage } from '@/features/pos/TerminalPage'

const createOrderMock = vi.mocked(createOrder)

function speakingIn(language: string) {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
}

/** The cart the till handed to createOrder — the lines that become the order document. */
const lastCart = () => createOrderMock.mock.calls.at(-1)?.[0].cart ?? []
const lastLineNames = () => lastCart().map((line) => line.name)

beforeEach(() => {
  window.localStorage.clear()
  currentOperator = null
  createOrderMock.mockReset()
  createOrderMock.mockResolvedValue({ id: 'order-1', number: 1 })
})

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('lang')
  vi.clearAllMocks()
})

async function openTill() {
  const rendered = renderComponent(<TerminalPage />)
  await rendered.user.click(screen.getByText('Alice'))
  return rendered
}

describe('what the counter reads', () => {
  it('shows English names on an English till', async () => {
    await openTill()
    expect(screen.getByText('Fried Rice')).not.toBeNull()
    expect(screen.getByText('Teh Tarik')).not.toBeNull()
  })

  it('shows the Malay name on a Malay till', async () => {
    speakingIn('ms')
    await openTill()

    expect(screen.getByText('Nasi Goreng')).not.toBeNull()
    expect(screen.queryByText('Fried Rice')).toBeNull()
    // Untranslated, so English rather than a blank tile.
    expect(screen.getByText('Teh Tarik')).not.toBeNull()
  })

  it('shows the Chinese name on a Chinese till', async () => {
    speakingIn('zh')
    await openTill()

    expect(screen.getByText('炒饭')).not.toBeNull()
    expect(screen.getByText('Teh Tarik')).not.toBeNull()
  })

  it('keeps the tile findable by its canonical English name whatever the language', async () => {
    speakingIn('zh')
    await openTill()

    const tile = document.querySelector('[data-item-name="Fried Rice"]')
    expect(tile).not.toBeNull()
    expect(tile?.textContent).toContain('炒饭')
  })
})

describe('what the order records', () => {
  async function ringUpOn(language: string, itemLabel: string) {
    speakingIn(language)
    const { user } = await openTill()
    await user.click(screen.getByText(itemLabel))
    // By id rather than by label: the label is interface text, so it is translated on a till
    // set to anything but English, and this test is about the item's name, not the field's.
    await user.type(document.getElementById('table-number')!, '5')
    await user.click(screen.getByTestId('place-order'))
  }

  it('snapshots the name the counter was showing', async () => {
    await ringUpOn('ms', 'Nasi Goreng')
    expect(lastLineNames()).toEqual(['Nasi Goreng'])
  })

  it('snapshots the Chinese name from a Chinese till', async () => {
    await ringUpOn('zh', '炒饭')
    expect(lastLineNames()).toEqual(['炒饭'])
  })

  it('snapshots English for an item with no translation', async () => {
    await ringUpOn('ms', 'Teh Tarik')
    expect(lastLineNames()).toEqual(['Teh Tarik'])
  })

  it('records the item id alongside it, which is what reports aggregate by', async () => {
    await ringUpOn('ms', 'Nasi Goreng')
    expect(lastCart().map((line) => line.menuItemId)).toEqual(['fried-rice'])
  })
})
