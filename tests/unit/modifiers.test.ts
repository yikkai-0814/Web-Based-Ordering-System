import { describe, expect, it } from 'vitest'

import {
  describeModifiers,
  lineKeyOf,
  modifiersTotal,
  offeredGroupsFor,
  parseModifierGroup,
  requiresCustomisation,
  selectionOf,
  unitPriceWith,
  validateSelections,
  type ModifierGroup,
  type SelectedModifier,
} from '@/features/menu/modifiers'
import { addToCart, cartTotal, EMPTY_CART, type Cart } from '@/features/pos/cart'

/**
 * Menu item customisation.
 *
 * Two claims are under test throughout. That a group's rules are DATA — the same four
 * combinations of `selection` and `required` work for any item, with nothing hard-coded per
 * dish. And that a line is identified by its whole configuration, so the same dish ordered
 * two ways can never be collapsed into one.
 */

function group(over: Partial<ModifierGroup> = {}): ModifierGroup {
  return {
    id: 'g-veg',
    itemId: 'chicken-chop-rice',
    name: 'Vegetables',
    selection: 'single',
    required: true,
    sortOrder: 0,
    active: true,
    options: [
      { id: 'veg-normal', name: 'Normal', priceAdjustment: 0, active: true },
      { id: 'veg-none', name: 'No vegetables', priceAdjustment: 0, active: true },
    ],
    createdAt: null,
    updatedAt: null,
    ...over,
  }
}

const ADDONS = group({
  id: 'g-addons',
  name: 'Add-ons',
  selection: 'multiple',
  required: false,
  sortOrder: 2,
  options: [
    { id: 'add-egg', name: 'Extra egg', priceAdjustment: 100, active: true },
    { id: 'add-chicken', name: 'Extra chicken', priceAdjustment: 300, active: true },
  ],
})

const pick = (from: ModifierGroup, optionId: string): SelectedModifier => {
  const option = from.options.find((candidate) => candidate.id === optionId)
  if (!option) throw new Error(`no option ${optionId}`)
  return selectionOf(from, option)
}

describe('what an item offers', () => {
  it('offers nothing for an item with no groups, so it stays a one-tap add', () => {
    expect(offeredGroupsFor([group()], 'milo')).toEqual([])
    expect(requiresCustomisation([group()], 'milo')).toBe(false)
  })

  it('offers each item its own configuration, never a shared one', () => {
    const ice = group({ id: 'g-ice', itemId: 'milo', name: 'Ice' })
    const offered = offeredGroupsFor([group(), ADDONS, ice], 'milo')
    expect(offered.map((entry) => entry.name)).toEqual(['Ice'])
  })

  it('orders groups by sortOrder, so the prompt reads the same way every time', () => {
    const egg = group({ id: 'g-egg', name: 'Egg', sortOrder: 1 })
    const offered = offeredGroupsFor([ADDONS, egg, group()], 'chicken-chop-rice')
    expect(offered.map((entry) => entry.name)).toEqual(['Vegetables', 'Egg', 'Add-ons'])
  })

  it('hides a deactivated group without touching the receipts that mention it', () => {
    expect(offeredGroupsFor([group({ active: false })], 'chicken-chop-rice')).toEqual([])
  })

  it('hides a deactivated option, and the whole group once none are left', () => {
    const partly = group({
      options: [
        { id: 'veg-normal', name: 'Normal', priceAdjustment: 0, active: true },
        { id: 'veg-none', name: 'No vegetables', priceAdjustment: 0, active: false },
      ],
    })
    expect(offeredGroupsFor([partly], 'chicken-chop-rice')[0]?.options).toHaveLength(1)

    const emptied = group({
      options: [{ id: 'veg-normal', name: 'Normal', priceAdjustment: 0, active: false }],
    })
    expect(offeredGroupsFor([emptied], 'chicken-chop-rice')).toEqual([])
  })
})

describe('selection rules are data, not per-item code', () => {
  it('single + required means exactly one', () => {
    const groups = [group()]
    expect(validateSelections(groups, []).ok).toBe(false)
    expect(validateSelections(groups, [pick(group(), 'veg-normal')]).ok).toBe(true)
    expect(
      validateSelections(groups, [pick(group(), 'veg-normal'), pick(group(), 'veg-none')]).ok,
    ).toBe(false)
  })

  it('single + optional means at most one, and may be skipped', () => {
    const optional = group({ required: false })
    expect(validateSelections([optional], []).ok).toBe(true)
    expect(validateSelections([optional], [pick(optional, 'veg-normal')]).ok).toBe(true)
    expect(
      validateSelections([optional], [pick(optional, 'veg-normal'), pick(optional, 'veg-none')]).ok,
    ).toBe(false)
  })

  it('multiple + optional accepts none, one, or several', () => {
    expect(validateSelections([ADDONS], []).ok).toBe(true)
    expect(validateSelections([ADDONS], [pick(ADDONS, 'add-egg')]).ok).toBe(true)
    expect(
      validateSelections([ADDONS], [pick(ADDONS, 'add-egg'), pick(ADDONS, 'add-chicken')]).ok,
    ).toBe(true)
  })

  it('multiple + required needs at least one', () => {
    const needed = group({ ...ADDONS, required: true })
    expect(validateSelections([needed], []).ok).toBe(false)
    expect(validateSelections([needed], [pick(needed, 'add-egg')]).ok).toBe(true)
  })

  it('names the group that is unanswered, so the counter is not left guessing', () => {
    const result = validateSelections([group()], [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('vegetables')
  })

  it('refuses a choice that belongs to no offered group', () => {
    const stray = pick(ADDONS, 'add-egg')
    expect(validateSelections([group()], [stray]).ok).toBe(false)
  })

  it('refuses a choice whose option has since been withdrawn', () => {
    const withdrawn = group({ options: [group().options[0]!] })
    expect(validateSelections([withdrawn], [pick(group(), 'veg-none')]).ok).toBe(false)
  })
})

describe('pricing stays in whole sen', () => {
  it('adds nothing for options that cost nothing', () => {
    expect(unitPriceWith(800, [pick(group(), 'veg-none')])).toBe(800)
  })

  it('adds a single surcharge', () => {
    // RM8.00 + RM1.00 = RM9.00, the worked example.
    expect(unitPriceWith(800, [pick(ADDONS, 'add-egg')])).toBe(900)
  })

  it('adds several surcharges exactly', () => {
    const chosen = [pick(ADDONS, 'add-egg'), pick(ADDONS, 'add-chicken')]
    expect(modifiersTotal(chosen)).toBe(400)
    expect(unitPriceWith(800, chosen)).toBe(1200)
  })

  it('never produces a fraction, whatever the combination', () => {
    const chosen = [pick(ADDONS, 'add-egg'), pick(ADDONS, 'add-chicken')]
    const price = unitPriceWith(1595, chosen)
    expect(Number.isInteger(price)).toBe(true)
    expect(price).toBe(1995)
  })

  it('never goes below zero', () => {
    const discount = group({
      options: [{ id: 'off', name: 'Off', priceAdjustment: -5000, active: true }],
    })
    expect(unitPriceWith(800, [pick(discount, 'off')])).toBe(0)
  })
})

describe('a line is identified by its whole configuration', () => {
  it('gives the same key to the same item with the same options', () => {
    const a = { menuItemId: 'ccr', modifiers: [pick(ADDONS, 'add-egg')] }
    const b = { menuItemId: 'ccr', modifiers: [pick(ADDONS, 'add-egg')] }
    expect(lineKeyOf(a)).toBe(lineKeyOf(b))
  })

  it('ignores the order the options were tapped in', () => {
    const one = [pick(ADDONS, 'add-egg'), pick(ADDONS, 'add-chicken')]
    const other = [pick(ADDONS, 'add-chicken'), pick(ADDONS, 'add-egg')]
    expect(lineKeyOf({ menuItemId: 'ccr', modifiers: one })).toBe(
      lineKeyOf({ menuItemId: 'ccr', modifiers: other }),
    )
  })

  it('gives different keys to different configurations of the same item', () => {
    const plain = lineKeyOf({ menuItemId: 'ccr', modifiers: [] })
    const withEgg = lineKeyOf({ menuItemId: 'ccr', modifiers: [pick(ADDONS, 'add-egg')] })
    const withBoth = lineKeyOf({
      menuItemId: 'ccr',
      modifiers: [pick(ADDONS, 'add-egg'), pick(ADDONS, 'add-chicken')],
    })
    expect(new Set([plain, withEgg, withBoth]).size).toBe(3)
  })

  it('gives different keys to different items with the same options', () => {
    expect(lineKeyOf({ menuItemId: 'a', modifiers: [] })).not.toBe(
      lineKeyOf({ menuItemId: 'b', modifiers: [] }),
    )
  })
})

describe('the cart merges identical configurations and separates different ones', () => {
  const CHICKEN = { menuItemId: 'ccr', name: 'Chicken Chop Rice', basePrice: 800 }
  const noVegNoEgg = [pick(group(), 'veg-none')]
  const extraEgg = [pick(ADDONS, 'add-egg')]

  it('merges the same dish ordered the same way into one line of two', () => {
    let cart: Cart = EMPTY_CART
    cart = addToCart(cart, { ...CHICKEN, modifiers: noVegNoEgg })
    cart = addToCart(cart, { ...CHICKEN, modifiers: noVegNoEgg })

    expect(cart).toHaveLength(1)
    expect(cart[0]?.quantity).toBe(2)
    expect(cart[0]?.modifiers).toHaveLength(1)
  })

  it('keeps the same dish ordered differently on separate lines', () => {
    let cart: Cart = EMPTY_CART
    cart = addToCart(cart, { ...CHICKEN, modifiers: noVegNoEgg })
    cart = addToCart(cart, { ...CHICKEN, modifiers: extraEgg })

    expect(cart).toHaveLength(2)
    expect(cart.map((line) => line.quantity)).toEqual([1, 1])
    // The distinction that must never be lost: same dish, two different things to make.
    expect(cart[0]?.unitPrice).toBe(800)
    expect(cart[1]?.unitPrice).toBe(900)
  })

  it('keeps a plain add separate from a customised one', () => {
    let cart: Cart = EMPTY_CART
    cart = addToCart(cart, CHICKEN)
    cart = addToCart(cart, { ...CHICKEN, modifiers: extraEgg })
    expect(cart).toHaveLength(2)
  })

  it('totals a mixed cart exactly', () => {
    let cart: Cart = EMPTY_CART
    cart = addToCart(cart, { ...CHICKEN, modifiers: noVegNoEgg })
    cart = addToCart(cart, { ...CHICKEN, modifiers: noVegNoEgg })
    cart = addToCart(cart, { ...CHICKEN, modifiers: extraEgg })
    // 2 × 800 + 1 × 900
    expect(cartTotal(cart)).toBe(2500)
  })

  it('records the base price and the surcharge separately on the line', () => {
    const cart = addToCart(EMPTY_CART, { ...CHICKEN, modifiers: extraEgg })
    expect(cart[0]?.basePrice).toBe(800)
    expect(cart[0]?.unitPrice).toBe(900)
    expect(cart[0]?.modifiers[0]?.priceAdjustment).toBe(100)
  })
})

describe('parseModifierGroup refuses what it cannot render', () => {
  const raw = {
    itemId: 'ccr',
    name: 'Vegetables',
    selection: 'single',
    required: true,
    sortOrder: 0,
    active: true,
    options: [{ id: 'veg-normal', name: 'Normal', priceAdjustment: 0, active: true }],
  }

  it('parses a well-formed group', () => {
    const parsed = parseModifierGroup('g1', { ...raw })
    expect(parsed?.name).toBe('Vegetables')
    expect(parsed?.options).toHaveLength(1)
  })

  it('refuses an unknown selection mode', () => {
    expect(parseModifierGroup('g1', { ...raw, selection: 'lots' })).toBeNull()
  })

  it('refuses a fractional price adjustment rather than rounding it', () => {
    const options = [{ id: 'o', name: 'O', priceAdjustment: 1.5, active: true }]
    expect(parseModifierGroup('g1', { ...raw, options })).toBeNull()
  })

  it('refuses the whole group when one option is malformed', () => {
    // A partial prompt is a wrong prompt: the missing choice is one the customer may want.
    const options = [raw.options[0], { id: '', name: '', priceAdjustment: 0, active: true }]
    expect(parseModifierGroup('g1', { ...raw, options })).toBeNull()
  })

  it('refuses a group with no item', () => {
    expect(parseModifierGroup('g1', { ...raw, itemId: '' })).toBeNull()
  })
})

describe('describeModifiers', () => {
  it('reads as the customer would say it', () => {
    const chosen = [pick(group(), 'veg-none'), pick(ADDONS, 'add-chicken')]
    expect(describeModifiers(chosen)).toBe('No vegetables · Extra chicken')
  })

  it('is empty when nothing was customised', () => {
    expect(describeModifiers([])).toBe('')
  })
})
