import { describe, expect, it } from 'vitest'

import { addToCart, EMPTY_CART } from '@/features/pos/cart'
import { getLocalizedMenuItemName } from '@/features/menu/item-names'
import { parseMenuItem } from '@/features/menu/types'
import { parseOrder } from '@/features/pos/types'
import {
  buildReport,
  indexCostHistory,
  indexModifierCostHistory,
  type ReportOrder,
  type ReportVoidInfo,
} from '@/features/reports/aggregate'

/**
 * Translating a menu item must not reach backwards into orders already placed.
 *
 * A line's name is a snapshot taken when the customer was standing at the counter: it is
 * what they were told they were buying, and a receipt that changed wording months later
 * would be a different claim about a past transaction. That guarantee predates this feature —
 * `addToCart` has always copied the name — and these tests pin it against the new way the
 * name is chosen, because the till now picks it by language rather than reading one field.
 */

const FRIED_RICE = {
  name: 'Fried Rice',
  names: { ms: 'Nasi Goreng', zh: '炒饭' },
  description: '',
  categoryId: 'mains',
  price: 800,
  sortOrder: 0,
  active: true,
  createdAt: null,
  updatedAt: null,
}

describe('an order snapshots the name the counter was showing', () => {
  it('takes the Malay name when the till is speaking Malay', () => {
    const item = parseMenuItem('i1', FRIED_RICE)!
    const cart = addToCart(EMPTY_CART, {
      menuItemId: item.id,
      name: getLocalizedMenuItemName(item, 'ms'),
      basePrice: item.price,
    })

    expect(cart[0]?.name).toBe('Nasi Goreng')
  })

  it('takes the English name when the item has no translation for the till', () => {
    const noMalay = parseMenuItem('i1', { ...FRIED_RICE, names: { zh: '炒饭' } })!
    const cart = addToCart(EMPTY_CART, {
      menuItemId: noMalay.id,
      name: getLocalizedMenuItemName(noMalay, 'ms'),
      basePrice: noMalay.price,
    })

    expect(cart[0]?.name).toBe('Fried Rice')
  })
})

describe('retranslating an item does not rewrite what was already sold', () => {
  it('leaves the line on the name it was rung up under', () => {
    const before = parseMenuItem('i1', FRIED_RICE)!
    const cart = addToCart(EMPTY_CART, {
      menuItemId: before.id,
      name: getLocalizedMenuItemName(before, 'ms'),
      basePrice: before.price,
    })

    // The admin edits the item afterwards: new English name, new Malay name.
    const after = parseMenuItem('i1', {
      ...FRIED_RICE,
      name: 'Special Fried Rice',
      names: { ms: 'Nasi Goreng Special', zh: '特制炒饭' },
    })!

    // The cart — and therefore the order written from it — is untouched by that edit.
    expect(cart[0]?.name).toBe('Nasi Goreng')
    expect(getLocalizedMenuItemName(after, 'ms')).toBe('Nasi Goreng Special')
  })

  it('keeps an order written before the edit readable, exactly as stored', () => {
    const order = parseOrder('o1', {
      number: 7,
      businessDate: '2026-09-17',
      lines: [
        { menuItemId: 'i1', name: 'Nasi Goreng', basePrice: 800, unitPrice: 800, quantity: 2 },
      ],
      total: 1600,
      createdBy: 'till-uid',
      createdByName: 'Shared Till',
      staffId: 'alice',
      staffName: 'Alice',
    })

    // Nothing here consults the menu: the order says what it says.
    expect(order?.lines[0]?.name).toBe('Nasi Goreng')
    expect(order?.lines[0]?.menuItemId).toBe('i1')
  })
})

describe('reports aggregate by the item, not by what it was called', () => {
  it('counts sales of one item as one row across languages and renames', () => {
    const sold = (name: string, businessDate: string, createdAt: Date): ReportOrder => ({
      id: `o-${name}-${businessDate}`,
      number: 1,
      businessDate,
      createdAt,
      lines: [
        { menuItemId: 'i1', name, basePrice: 800, unitPrice: 800, modifiers: [], quantity: 1 },
      ],
      total: 800,
      paid: true,
      paymentMethod: 'cash',
    })

    const report = buildReport({
      orders: [
        sold('Fried Rice', '2026-09-15', new Date('2026-09-15T10:00:00')),
        sold('Nasi Goreng', '2026-09-16', new Date('2026-09-16T10:00:00')),
        sold('炒饭', '2026-09-17', new Date('2026-09-17T10:00:00')),
      ],
      voids: new Map<string, ReportVoidInfo>(),
      history: indexCostHistory([]),
      currentCosts: new Map<string, number>(),
      modifierHistory: indexModifierCostHistory([]),
      modifierCurrentCosts: new Map<string, number>(),
    })

    // One row, three sales: identity is the menu item id, never the words on the line.
    expect(report.items).toHaveLength(1)
    expect(report.items[0]?.menuItemId).toBe('i1')
    expect(report.items[0]?.quantity).toBe(3)
    expect(report.items[0]?.revenue).toBe(2400)
  })
})
