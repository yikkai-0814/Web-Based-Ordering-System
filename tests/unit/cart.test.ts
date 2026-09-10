import { describe, expect, it } from 'vitest'

import {
  addToCart,
  cartItemCount,
  cartTotal,
  changeDue,
  clearCart,
  decrementLine,
  EMPTY_CART,
  incrementLine,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  removeLine,
  setQuantity,
  validateCart,
  type Cart,
} from '@/features/pos/cart'

const FLAT_WHITE = { menuItemId: 'i1', name: 'Flat White', unitPrice: 1250 }
const CROISSANT = { menuItemId: 'i2', name: 'Croissant', unitPrice: 690 }
const JUICE = { menuItemId: 'i3', name: 'Orange Juice', unitPrice: 815 }

/** Builds a cart by adding each item once, in order. */
const build = (...items: { menuItemId: string; name: string; unitPrice: number }[]): Cart =>
  items.reduce<Cart>((cart, item) => addToCart(cart, item), EMPTY_CART)

describe('addToCart', () => {
  it('adds a new line with quantity 1', () => {
    const cart = addToCart(EMPTY_CART, FLAT_WHITE)
    expect(cart).toHaveLength(1)
    expect(cart[0]?.quantity).toBe(1)
    expect(cart[0]?.name).toBe('Flat White')
  })

  it('increments the existing line instead of duplicating it', () => {
    const cart = addToCart(addToCart(EMPTY_CART, FLAT_WHITE), FLAT_WHITE)
    expect(cart).toHaveLength(1)
    expect(cart[0]?.quantity).toBe(2)
  })

  it('keeps distinct items on separate lines', () => {
    const cart = build(FLAT_WHITE, CROISSANT, JUICE)
    expect(cart).toHaveLength(3)
  })

  it('does not mutate the cart it was given', () => {
    const original = build(FLAT_WHITE)
    const next = addToCart(original, CROISSANT)
    expect(original).toHaveLength(1)
    expect(next).toHaveLength(2)
  })

  it('keeps the price captured when the line was created, not a later one', () => {
    // The customer was quoted 12.50; an admin repricing mid-order must not change that.
    const cart = addToCart(build(FLAT_WHITE), { ...FLAT_WHITE, unitPrice: 9999 })
    expect(cart).toHaveLength(1)
    expect(cart[0]?.unitPrice).toBe(1250)
    expect(cartTotal(cart)).toBe(2500)
  })

  it('refuses to exceed the per-line quantity cap', () => {
    let cart = addToCart(EMPTY_CART, FLAT_WHITE)
    cart = setQuantity(cart, 'i1', MAX_LINE_QUANTITY)
    cart = addToCart(cart, FLAT_WHITE)
    expect(cart[0]?.quantity).toBe(MAX_LINE_QUANTITY)
  })

  it('refuses to exceed the line-count cap', () => {
    let cart: Cart = EMPTY_CART
    for (let i = 0; i < MAX_CART_LINES + 5; i += 1) {
      cart = addToCart(cart, { menuItemId: `x${i}`, name: `Item ${i}`, unitPrice: 100 })
    }
    expect(cart).toHaveLength(MAX_CART_LINES)
  })
})

describe('quantity changes', () => {
  it('increments and decrements a line', () => {
    let cart = build(FLAT_WHITE)
    cart = incrementLine(cart, 'i1')
    expect(cart[0]?.quantity).toBe(2)
    cart = decrementLine(cart, 'i1')
    expect(cart[0]?.quantity).toBe(1)
  })

  it('removes the line when the quantity drops to zero', () => {
    const cart = decrementLine(build(FLAT_WHITE), 'i1')
    expect(cart).toHaveLength(0)
  })

  it('removes the line when set to zero or a negative quantity', () => {
    expect(setQuantity(build(FLAT_WHITE), 'i1', 0)).toHaveLength(0)
    expect(setQuantity(build(FLAT_WHITE), 'i1', -3)).toHaveLength(0)
  })

  it('ignores changes to an item that is not in the cart', () => {
    const cart = build(FLAT_WHITE)
    expect(incrementLine(cart, 'nope')).toEqual(cart)
    expect(decrementLine(cart, 'nope')).toEqual(cart)
    expect(removeLine(cart, 'nope')).toEqual(cart)
  })

  it('removes only the targeted line', () => {
    const cart = removeLine(build(FLAT_WHITE, CROISSANT), 'i1')
    expect(cart).toHaveLength(1)
    expect(cart[0]?.menuItemId).toBe('i2')
  })

  it('clears the whole cart', () => {
    expect(clearCart()).toHaveLength(0)
  })
})

describe('totals', () => {
  it('is zero for an empty cart', () => {
    expect(cartTotal(EMPTY_CART)).toBe(0)
    expect(cartItemCount(EMPTY_CART)).toBe(0)
  })

  it('multiplies and sums exactly', () => {
    let cart = build(FLAT_WHITE, CROISSANT)
    cart = setQuantity(cart, 'i1', 2)
    // 2 x 12.50 + 1 x 6.90 = 31.90
    expect(cartTotal(cart)).toBe(3190)
    expect(cartItemCount(cart)).toBe(3)
  })

  it('stays exact on the prices that break naive float maths', () => {
    // 1.15, 2.35 and 8.20 are the classic offenders: parseFloat('1.15') * 100 is
    // 114.99999999999999. Integer sen make these exact at any quantity.
    const awkward = [
      { menuItemId: 'a', name: 'A', unitPrice: 115 },
      { menuItemId: 'b', name: 'B', unitPrice: 235 },
      { menuItemId: 'c', name: 'C', unitPrice: 820 },
    ]
    let cart = build(...awkward)
    cart = setQuantity(cart, 'a', 3)
    cart = setQuantity(cart, 'b', 7)
    cart = setQuantity(cart, 'c', 11)
    // 345 + 1645 + 9020
    expect(cartTotal(cart)).toBe(11010)
    expect(Number.isInteger(cartTotal(cart))).toBe(true)
  })

  it('accumulates a hundred lines without drift', () => {
    let cart: Cart = EMPTY_CART
    for (let i = 0; i < 100; i += 1) {
      cart = addToCart(cart, { menuItemId: `x${i}`, name: `Item ${i}`, unitPrice: 115 })
    }
    expect(cartTotal(cart)).toBe(11500)
  })
})

describe('changeDue', () => {
  it('returns the difference for an over-payment', () => {
    const result = changeDue(3190, 5000)
    expect(result).toEqual({ ok: true, change: 1810 })
  })

  it('returns zero change for exact tender', () => {
    expect(changeDue(3190, 3190)).toEqual({ ok: true, change: 0 })
  })

  it('refuses an under-payment rather than returning negative change', () => {
    const result = changeDue(3190, 3000)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/less than the total/i)
  })

  it('refuses non-integer amounts', () => {
    expect(changeDue(31.9, 5000).ok).toBe(false)
    expect(changeDue(3190, 50.5).ok).toBe(false)
  })

  it('is exact for awkward totals', () => {
    expect(changeDue(11010, 20000)).toEqual({ ok: true, change: 8990 })
    expect(changeDue(115, 10000)).toEqual({ ok: true, change: 9885 })
  })
})

describe('validateCart', () => {
  it('refuses an empty cart', () => {
    const result = validateCart(EMPTY_CART)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/at least one item/i)
  })

  it('accepts a normal cart', () => {
    expect(validateCart(build(FLAT_WHITE, CROISSANT))).toEqual({ ok: true })
  })

  it('refuses a line with a fractional price', () => {
    const bad: Cart = [{ menuItemId: 'i1', name: 'Bad', unitPrice: 12.5, quantity: 1 }]
    const result = validateCart(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/invalid price/i)
  })

  it('refuses a line with a negative price or zero quantity', () => {
    expect(validateCart([{ menuItemId: 'i', name: 'X', unitPrice: -1, quantity: 1 }]).ok).toBe(
      false,
    )
    expect(validateCart([{ menuItemId: 'i', name: 'X', unitPrice: 100, quantity: 0 }]).ok).toBe(
      false,
    )
  })
})
