import { say } from '../say'
import { describe, expect, it } from 'vitest'

import type { Language } from '@/features/i18n/languages'
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
      {
        id: 'veg-normal',
        name: 'Normal',
        names: { en: 'Normal', ms: '', zh: '' },
        priceAdjustment: 0,
        active: true,
      },
      {
        id: 'veg-none',
        name: 'No vegetables',
        names: { en: 'No vegetables', ms: '', zh: '' },
        priceAdjustment: 0,
        active: true,
      },
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
    {
      id: 'add-egg',
      name: 'Extra egg',
      names: { en: 'Extra egg', ms: '', zh: '' },
      priceAdjustment: 100,
      active: true,
    },
    {
      id: 'add-chicken',
      name: 'Extra chicken',
      names: { en: 'Extra chicken', ms: '', zh: '' },
      priceAdjustment: 300,
      active: true,
    },
  ],
})

/**
 * The bit of a menu item that decides what it asks. Legacy groups name the item in `itemId`
 * and need nothing here; shared ones are listed by the item, in the order it wants them.
 */
const item = (id: string, modifierGroupIds: string[] = []) => ({ id, modifierGroupIds })

/**
 * One chosen option, snapshotted as the till would. The language is explicit because that is
 * what `selectionOf` captures: the name the counter was showing, not the option's id.
 */
const pick = (
  from: ModifierGroup,
  optionId: string,
  language: Language = 'en',
): SelectedModifier => {
  const option = from.options.find((candidate) => candidate.id === optionId)
  if (!option) throw new Error(`no option ${optionId}`)
  return selectionOf(from, option, language)
}

describe('what an item offers', () => {
  it('offers nothing for an item with no groups, so it stays a one-tap add', () => {
    expect(offeredGroupsFor([group()], item('milo'))).toEqual([])
    expect(requiresCustomisation([group()], item('milo'))).toBe(false)
  })

  it('offers a legacy group only to the item that owns it', () => {
    const ice = group({ id: 'g-ice', itemId: 'milo', name: 'Ice' })
    const offered = offeredGroupsFor([group(), ADDONS, ice], item('milo'))
    expect(offered.map((entry) => entry.name)).toEqual(['Ice'])
  })

  it('orders groups by sortOrder, so the prompt reads the same way every time', () => {
    const egg = group({ id: 'g-egg', name: 'Egg', sortOrder: 1 })
    const offered = offeredGroupsFor([ADDONS, egg, group()], item('chicken-chop-rice'))
    expect(offered.map((entry) => entry.name)).toEqual(['Vegetables', 'Egg', 'Add-ons'])
  })

  it('offers a shared group to every item that lists it', () => {
    const sugar = group({ id: 'g-sugar', itemId: null, name: 'Sugar Level' })
    for (const drink of ['milk-tea', 'lemon-tea', 'coffee']) {
      const offered = offeredGroupsFor([sugar], item(drink, ['g-sugar']))
      expect(offered.map((entry) => entry.name)).toEqual(['Sugar Level'])
    }
  })

  it('does not offer a shared group to an item that has not attached it', () => {
    const sugar = group({ id: 'g-sugar', itemId: null, name: 'Sugar Level' })
    expect(offeredGroupsFor([sugar], item('americano'))).toEqual([])
  })

  it("takes the order from the item, not from the group's own sortOrder", () => {
    // Both carry sortOrder 0; only the item can say which comes first on THIS item, and the
    // two items deliberately disagree.
    const sugar = group({ id: 'g-sugar', itemId: null, name: 'Sugar Level' })
    const ice = group({ id: 'g-ice', itemId: null, name: 'Ice Level' })

    expect(
      offeredGroupsFor([sugar, ice], item('milk-tea', ['g-sugar', 'g-ice'])).map((e) => e.name),
    ).toEqual(['Sugar Level', 'Ice Level'])
    expect(
      offeredGroupsFor([sugar, ice], item('lemon-tea', ['g-ice', 'g-sugar'])).map((e) => e.name),
    ).toEqual(['Ice Level', 'Sugar Level'])
  })

  it('hands every attached item the SAME definition, so one edit reaches all of them', () => {
    // The mechanism behind "editing a shared group changes every item using it": nothing is
    // copied per item, so there is only ever one thing to edit.
    const sugar = group({ id: 'g-sugar', itemId: null, name: 'Sugar Level' })
    const onCoffee = offeredGroupsFor([sugar], item('iced-coffee', ['g-sugar']))[0]
    const onTea = offeredGroupsFor([sugar], item('milk-tea', ['g-sugar']))[0]

    expect(onCoffee?.name).toBe('Sugar Level')
    expect(onTea?.name).toBe(onCoffee?.name)
    expect(onTea?.id).toBe(onCoffee?.id)

    // Edit the one definition; both items resolve to the new wording.
    const renamed = { ...sugar, name: 'Sweetness' }
    expect(offeredGroupsFor([renamed], item('iced-coffee', ['g-sugar']))[0]?.name).toBe('Sweetness')
    expect(offeredGroupsFor([renamed], item('milk-tea', ['g-sugar']))[0]?.name).toBe('Sweetness')
  })

  it('keeps an item-specific group to its own item, however another item is configured', () => {
    // An owned group is reachable only through its owner. Even an item that somehow lists its
    // id is not offered it — which is what stops one item editing another item's private
    // customisation by attaching it.
    const patty = group({ id: 'g-patty', itemId: 'burger', name: 'Patty Cooking Level' })

    expect(offeredGroupsFor([patty], item('burger')).map((e) => e.name)).toEqual([
      'Patty Cooking Level',
    ])
    expect(offeredGroupsFor([patty], item('hot-dog')).map((e) => e.name)).toEqual([])
    // Even listing its id does not get it: ownership is the group's own statement and a list
    // on another item cannot override it.
    expect(offeredGroupsFor([patty], item('hot-dog', ['g-patty'])).map((e) => e.name)).toEqual([])
    // Its owner still reaches it when it is listed as well, rather than being locked out.
    expect(offeredGroupsFor([patty], item('burger', ['g-patty'])).map((e) => e.name)).toEqual([
      'Patty Cooking Level',
    ])
  })

  it('resolves legacy and shared groups together, legacy last', () => {
    const legacy = group({ id: 'g-veg', itemId: 'rice', name: 'Vegetables' })
    const sugar = group({ id: 'g-sugar', itemId: null, name: 'Sugar Level' })
    const offered = offeredGroupsFor([legacy, sugar], item('rice', ['g-sugar']))
    expect(offered.map((entry) => entry.name)).toEqual(['Sugar Level', 'Vegetables'])
  })

  it('skips an id whose group has been deleted rather than reporting a fault', () => {
    const sugar = group({ id: 'g-sugar', itemId: null, name: 'Sugar Level' })
    const offered = offeredGroupsFor([sugar], item('milk-tea', ['g-gone', 'g-sugar']))
    expect(offered.map((entry) => entry.name)).toEqual(['Sugar Level'])
  })

  it('never offers the same group twice, however it is reached', () => {
    const both = group({ id: 'g-veg', itemId: 'rice', name: 'Vegetables' })
    expect(offeredGroupsFor([both], item('rice', ['g-veg', 'g-veg']))).toHaveLength(1)
  })

  it('hides a deactivated group without touching the receipts that mention it', () => {
    expect(offeredGroupsFor([group({ active: false })], item('chicken-chop-rice'))).toEqual([])
  })

  it('hides a deactivated option, and the whole group once none are left', () => {
    const partly = group({
      options: [
        {
          id: 'veg-normal',
          name: 'Normal',
          names: { en: 'Normal', ms: '', zh: '' },
          priceAdjustment: 0,
          active: true,
        },
        {
          id: 'veg-none',
          name: 'No vegetables',
          names: { en: 'No vegetables', ms: '', zh: '' },
          priceAdjustment: 0,
          active: false,
        },
      ],
    })
    expect(offeredGroupsFor([partly], item('chicken-chop-rice'))[0]?.options).toHaveLength(1)

    const emptied = group({
      options: [
        {
          id: 'veg-normal',
          name: 'Normal',
          names: { en: 'Normal', ms: '', zh: '' },
          priceAdjustment: 0,
          active: false,
        },
      ],
    })
    expect(offeredGroupsFor([emptied], item('chicken-chop-rice'))).toEqual([])
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
    // The vendor's own word, spliced in exactly as they typed it rather than case-folded.
    if (!result.ok) expect(say(result.error)).toContain('Vegetables')
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
      options: [
        {
          id: 'off',
          name: 'Off',
          names: { en: 'Off', ms: '', zh: '' },
          priceAdjustment: -5000,
          active: true,
        },
      ],
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
    options: [
      {
        id: 'veg-normal',
        name: 'Normal',
        names: { en: 'Normal', ms: '', zh: '' },
        priceAdjustment: 0,
        active: true,
      },
    ],
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
    const options = [
      {
        id: 'o',
        name: 'O',
        names: { en: 'O', ms: '', zh: '' },
        priceAdjustment: 1.5,
        active: true,
      },
    ]
    expect(parseModifierGroup('g1', { ...raw, options })).toBeNull()
  })

  it('refuses the whole group when one option is malformed', () => {
    // A partial prompt is a wrong prompt: the missing choice is one the customer may want.
    const options = [
      raw.options[0],
      { id: '', name: '', names: { en: '', ms: '', zh: '' }, priceAdjustment: 0, active: true },
    ]
    expect(parseModifierGroup('g1', { ...raw, options })).toBeNull()
  })

  /**
   * The contract changed deliberately when groups became reusable: a shared definition has no
   * single owner, so an absent `itemId` is the normal case rather than a malformed document.
   * A blank one is read the same way — as "no owner" — because the only thing it could
   * otherwise do is name an item that cannot exist.
   */
  it('reads a group with no item as a shared definition', () => {
    const shared = parseModifierGroup('g1', { ...raw, itemId: '' })
    expect(shared?.itemId).toBeNull()

    const { itemId: _omitted, ...withoutItemId } = raw
    expect(parseModifierGroup('g2', withoutItemId)?.itemId).toBeNull()
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
