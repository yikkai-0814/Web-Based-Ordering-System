// @vitest-environment jsdom
/**
 * New Order at every width: the phone summary bar, the cart column that never loses its
 * Place order button, and menu tiles that show a whole name.
 *
 * jsdom has no layout engine and no media or container queries, so nothing here can measure
 * a width. What it can pin is the structure those widths depend on — which element scrolls,
 * which ones may never shrink, what sticks where and by which shared value — plus everything
 * that is behaviour rather than layout: what the summary bar says, and where "Review order"
 * takes both the page and the focus. The layouts themselves were checked in a real browser at
 * 320–2560px; these keep the reasons they work from being undone quietly.
 */
import { useSyncExternalStore } from 'react'

import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LANGUAGE_STORAGE_KEY } from '@/features/i18n/languages'
import type { Operator } from '@/features/staff/staff-session'

import { renderComponent } from './render'

const ALICE: Operator = { id: 'alice', name: 'Alice', isSelf: false }
let currentOperator: Operator | null = null
const listeners = new Set<() => void>()

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    profile: { uid: 'till-uid', displayName: 'Shared Till', role: 'staff', active: true },
    status: 'authenticated',
    role: 'staff',
  }),
}))

vi.mock('@/features/staff/useStaffSession', () => ({
  useStaffSession: () => ({
    operator: useSyncExternalStore(
      (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => currentOperator,
    ),
    operators: [ALICE],
    loading: false,
    select: () => {
      currentOperator = ALICE
      for (const listener of listeners) listener()
    },
  }),
}))

const LONG_NAME = 'Nasi Lemak Ayam Goreng Berempah Special With Extra Sambal'

vi.mock('@/features/menu/useCategories', () => ({
  useCategories: () => ({
    categories: [{ id: 'rice', name: 'Rice', sortOrder: 1, active: true }],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/features/menu/useMenuItems', () => ({
  useMenuItems: () => ({
    items: [
      {
        id: 'kopi',
        name: 'Kopi O',
        categoryId: 'rice',
        price: 250,
        sortOrder: 1,
        active: true,
        modifierGroupIds: [],
      },
      {
        id: 'nasi',
        name: LONG_NAME,
        categoryId: 'rice',
        price: 1290,
        sortOrder: 2,
        active: true,
        modifierGroupIds: [],
      },
    ],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/features/menu/useModifierGroups', () => ({
  useModifierGroups: () => ({ groups: [], loading: false, error: null }),
}))

vi.mock('@/features/pos/pos-api', () => ({ createOrder: vi.fn() }))

import { TerminalPage } from '@/features/pos/TerminalPage'

const scrollIntoView = vi.fn()

beforeEach(() => {
  currentOperator = null
  window.localStorage.clear()
  scrollIntoView.mockReset()
  // jsdom implements neither; the page must cope with their absence and use them when present.
  Element.prototype.scrollIntoView = scrollIntoView
})

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('lang')
  vi.unstubAllGlobals()
})

/** Straight to the order screen, past the "who is making this order" question. */
async function openTheOrder() {
  const rendered = renderComponent(<TerminalPage />)
  await rendered.user.click(screen.getByTestId('staff-option'))
  return rendered
}

const tile = (name: string) =>
  screen.getAllByTestId('pos-item').find((each) => each.dataset.itemName === name)!
const cartColumn = () => document.querySelector('aside') as HTMLElement
const summary = () => screen.queryByTestId('order-summary')
const classesOf = (element: Element | null | undefined) => element?.className.split(/\s+/) ?? []

describe('the phone summary bar', () => {
  it('is not there until something is in the order', async () => {
    await openTheOrder()

    expect(summary()).toBeNull()
  })

  it('says how many items and what they come to', async () => {
    const { user } = await openTheOrder()

    await user.click(tile('Kopi O'))
    await user.click(tile('Kopi O'))
    await user.click(tile(LONG_NAME))

    expect(screen.getByTestId('order-summary-count').textContent).toBe('3 items')
    expect(screen.getByTestId('order-summary-total').textContent).toBe('RM 17.90')
  })

  it('uses the singular for one item', async () => {
    const { user } = await openTheOrder()

    await user.click(tile('Kopi O'))

    expect(screen.getByTestId('order-summary-count').textContent).toBe('1 item')
  })

  it('is a phone-only bar, riding above the mobile nav inside the menu', async () => {
    const { user } = await openTheOrder()
    await user.click(tile('Kopi O'))

    expect(classesOf(summary())).toEqual(
      expect.arrayContaining(['sticky', 'bottom-mobile-nav', 'md:hidden']),
    )
    // Sticky within the menu section, so at the end of the menu it rests above the cart
    // rather than covering it, and it never covers the last row of items for good.
    expect(summary()?.closest('section')).not.toBeNull()
    expect(cartColumn().contains(summary())).toBe(false)
  })

  it('takes the page and the focus to the cart', async () => {
    const { user } = await openTheOrder()
    await user.click(tile('Kopi O'))

    await user.click(screen.getByTestId('review-order'))

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(cartColumn())
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(document.activeElement).toBe(cartColumn())
    // Arriving is announced as arriving at the order, and it is not added to the tab order.
    expect(cartColumn().getAttribute('aria-label')).toBe('Current order')
    expect(cartColumn().getAttribute('tabindex')).toBe('-1')
  })

  it('jumps rather than glides for anyone who has asked for less motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
    const { user } = await openTheOrder()
    await user.click(tile('Kopi O'))

    await user.click(screen.getByTestId('review-order'))

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
  })

  it('does not place the order — it is a way to the cart, not a second Place order', async () => {
    const { createOrder } = await import('@/features/pos/pos-api')
    const { user } = await openTheOrder()
    await user.click(tile('Kopi O'))

    await user.click(screen.getByTestId('review-order'))

    expect(createOrder).not.toHaveBeenCalled()
  })

  it.each([
    ['ms', 'Semak pesanan'],
    ['zh', '查看订单'],
  ])('is labelled in the device language (%s)', async (language, label) => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    const { user } = await openTheOrder()
    await user.click(tile('Kopi O'))

    expect(screen.getByTestId('review-order').textContent).toBe(label)
  })
})

describe('the cart column', () => {
  it('sticks below the Topbar by the shared height, and fits the screen from md', async () => {
    await openTheOrder()

    expect(classesOf(cartColumn())).toEqual(
      expect.arrayContaining([
        'md:sticky',
        'md:top-[calc(var(--topbar-height)+1rem)]',
        'md:h-[calc(100svh-var(--topbar-height)-2rem)]',
        'scroll-mt-[calc(var(--topbar-height)+1rem)]',
      ]),
    )
    // The old offsets were numbers of their own, and one of them put the cart under the bar.
    expect(cartColumn().className).not.toMatch(/\blg:top-4\b|6rem/)
  })

  it('lets only the list of lines scroll, so Place order is never pushed out', async () => {
    const { user } = await openTheOrder()
    for (let tap = 0; tap < 3; tap += 1) await user.click(tile('Kopi O'))
    await user.click(tile(LONG_NAME))

    const panel = cartColumn().firstElementChild
    // The panel may be shorter than its lines…
    expect(classesOf(panel)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1']))
    expect(classesOf(panel)).not.toContain('h-full')
    // …because the list inside it is what scrolls.
    const list = within(cartColumn()).getAllByTestId('cart-line')[0]!.closest('ul')!.parentElement
    expect(classesOf(list)).toEqual(
      expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto']),
    )

    // Everything after the list keeps its height.
    const service = within(cartColumn()).getByRole('group', { name: 'Order type' }).closest('.p-4')
    expect(classesOf(service)).toContain('shrink-0')
    const footer = screen.getByTestId('place-order').parentElement
    expect(classesOf(footer)).toContain('shrink-0')
  })

  it('keeps Place order in the column it belongs to, after the list', async () => {
    const { user } = await openTheOrder()
    await user.click(tile('Kopi O'))

    const place = screen.getByTestId('place-order')
    const lines = within(cartColumn()).getAllByTestId('cart-line')
    expect(cartColumn().contains(place)).toBe(true)
    expect(lines.at(-1)!.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('pins the footer only where the mobile nav is, and not from md', async () => {
    await openTheOrder()

    const footer = screen.getByTestId('place-order').parentElement
    expect(classesOf(footer)).toEqual(
      expect.arrayContaining(['sticky', 'bottom-mobile-nav', 'md:static']),
    )
    // `lg:static` left it floating 68px up between 768 and 1023px, with no nav to clear.
    expect(classesOf(footer)).not.toContain('lg:static')
  })

  it('scrolls as a whole on a short screen, so Place order is reachable there too', async () => {
    const { user } = await openTheOrder()
    await user.click(tile('Kopi O'))

    // Under 40rem tall (a phone on its side, a 1024x600 tablet) the fixed parts alone are
    // taller than the column: the column scrolls, and the panel inside keeps its height.
    expect(classesOf(cartColumn())).toEqual(
      expect.arrayContaining(['md:short:overflow-y-auto', 'md:min-h-0']),
    )
    const panel = cartColumn().firstElementChild
    expect(classesOf(panel)).toContain('short:flex-none')
  })

  it('clips its corners without becoming the thing the footer sticks to', async () => {
    await openTheOrder()

    // `overflow-hidden` made the column a scroll container, so on a phone the "sticky"
    // footer sat 68px up inside the column, over the table number field. `clip` does not.
    expect(classesOf(cartColumn())).toContain('overflow-clip')
    expect(classesOf(cartColumn())).not.toContain('overflow-hidden')
  })

  it('sits beside the menu from md, as a column that widens with the screen', async () => {
    await openTheOrder()

    const layout = cartColumn().parentElement!
    expect(classesOf(layout)).toEqual(
      expect.arrayContaining([
        'md:grid-cols-[1fr_20rem]',
        'lg:grid-cols-[1fr_24rem]',
        'xl:grid-cols-[1fr_26rem]',
      ]),
    )
  })
})

describe('the menu tiles', () => {
  it('grow for a long name instead of clipping it under the price', async () => {
    await openTheOrder()

    const long = tile(LONG_NAME)
    expect(classesOf(long)).toContain('min-h-touch-lg')
    expect(classesOf(long)).not.toContain('h-touch-lg')
    // The whole name is there to read — not clamped to a couple of lines.
    const name = long.querySelector('span')!
    expect(name.textContent).toBe(LONG_NAME)
    expect(name.className).not.toMatch(/line-clamp/)
  })

  it('count columns from the width the menu has, not the width of the screen', async () => {
    await openTheOrder()

    const grid = tile('Kopi O').parentElement!
    expect(grid.closest('section')?.className).toContain('@container')
    expect(classesOf(grid)).toEqual(
      expect.arrayContaining(['grid-cols-2', '@lg:grid-cols-3', '@[50rem]:grid-cols-4']),
    )
  })
})
