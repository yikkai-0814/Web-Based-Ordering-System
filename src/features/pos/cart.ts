/**
 * Cart logic for the till.
 *
 * Deliberately pure: no React, no Firestore, no clock. Every function here takes a cart and
 * returns a new one, which is what makes the money arithmetic straightforward to test
 * exhaustively — and this is the one place in the system where amounts are multiplied and
 * summed rather than merely displayed.
 *
 * All amounts are whole sen (see src/lib/money.ts). Because quantities are integers and
 * prices are integers, every total here is exact; there is no rounding step to get wrong.
 *
 * **A line is identified by its configuration, not by its menu item.** One order can hold
 * two of the same dish made differently, so every function here keys on `lineId` — the
 * item plus exactly which options were chosen (see `lineKeyOf`). Adding the same item with
 * the same choices increments an existing line; adding it with different choices starts a
 * new one, and that distinction can never be collapsed.
 */

import { message, type Message } from '@/features/i18n/messages'
import {
  lineKeyOf,
  modifiersTotal,
  unitPriceWith,
  type SelectedModifier,
} from '@/features/menu/modifiers'

export interface CartLine {
  /**
   * Identity of the configured line — see `lineKeyOf`. Derived, never entered, and stable:
   * the same item with the same options always produces the same value.
   */
  lineId: string
  menuItemId: string
  /** Snapshotted at the moment the line was added — see addToCart. */
  name: string
  /** The item's own price, whole sen, snapshotted. Excludes the options. */
  basePrice: number
  /** Whole sen: `basePrice` plus every chosen adjustment. What the customer is charged. */
  unitPrice: number
  /** The chosen options, snapshotted. Empty for an item with no customisation. */
  modifiers: SelectedModifier[]
  quantity: number
}

export type Cart = readonly CartLine[]

export const EMPTY_CART: Cart = []

/** The maximum number of distinct lines one order may hold. Mirrored in firestore.rules. */
export const MAX_CART_LINES = 100

/** The largest quantity of a single item on one line. */
export const MAX_LINE_QUANTITY = 999

export interface AddToCartItem {
  menuItemId: string
  name: string
  /** The item's own price. The options are added on top; see `unitPriceWith`. */
  basePrice: number
  /** Omit for an item with no customisation. */
  modifiers?: readonly SelectedModifier[]
}

/**
 * Adds one of an item **as configured**, or increments the matching line.
 *
 * "Matching" means the same item with exactly the same options, which is what `lineKeyOf`
 * decides. Two Chicken Chop Rice with no vegetables become one line of two; one with no
 * vegetables and one with extra egg stay two lines, because the customer ordered two
 * different things and the kitchen has to be told so.
 *
 * The line keeps the `name`, `basePrice` and option adjustments captured the first time it
 * was added. If an admin edits a price or renames an option on another device while a
 * customer is mid-order, the cart holds the figures the customer was actually quoted — a
 * receipt should never disagree with what was said at the counter.
 */
export function addToCart(cart: Cart, item: AddToCartItem): Cart {
  const modifiers = [...(item.modifiers ?? [])]
  const lineId = lineKeyOf({ menuItemId: item.menuItemId, modifiers })
  const existing = cart.find((line) => line.lineId === lineId)

  if (existing) {
    if (existing.quantity >= MAX_LINE_QUANTITY) return cart
    return cart.map((line) =>
      line.lineId === lineId ? { ...line, quantity: line.quantity + 1 } : line,
    )
  }

  if (cart.length >= MAX_CART_LINES) return cart

  return [
    ...cart,
    {
      lineId,
      menuItemId: item.menuItemId,
      name: item.name,
      basePrice: item.basePrice,
      unitPrice: unitPriceWith(item.basePrice, modifiers),
      modifiers,
      quantity: 1,
    },
  ]
}

/** Sets an explicit quantity. Zero or less removes the line entirely. */
export function setQuantity(cart: Cart, lineId: string, quantity: number): Cart {
  if (quantity <= 0) return removeLine(cart, lineId)
  const capped = Math.min(Math.floor(quantity), MAX_LINE_QUANTITY)
  return cart.map((line) => (line.lineId === lineId ? { ...line, quantity: capped } : line))
}

export function incrementLine(cart: Cart, lineId: string): Cart {
  const line = cart.find((candidate) => candidate.lineId === lineId)
  if (!line) return cart
  return setQuantity(cart, lineId, line.quantity + 1)
}

/** Decrements by one; dropping to zero removes the line, which is what a till should do. */
export function decrementLine(cart: Cart, lineId: string): Cart {
  const line = cart.find((candidate) => candidate.lineId === lineId)
  if (!line) return cart
  return setQuantity(cart, lineId, line.quantity - 1)
}

export function removeLine(cart: Cart, lineId: string): Cart {
  return cart.filter((line) => line.lineId !== lineId)
}

export function clearCart(): Cart {
  return EMPTY_CART
}

/**
 * Whole sen. Integer maths throughout, so this is exact at any cart size.
 *
 * Typed on the two fields it uses rather than on `CartLine`, so an order's line — the same
 * arithmetic, a different snapshot — can be totalled by the same function.
 */
export function lineTotal(line: { unitPrice: number; quantity: number }): number {
  return line.unitPrice * line.quantity
}

export function cartTotal(cart: Cart): number {
  return cart.reduce((sum, line) => sum + lineTotal(line), 0)
}

/** Total number of physical items, for the "N items" badge. */
export function cartItemCount(cart: Cart): number {
  return cart.reduce((count, line) => count + line.quantity, 0)
}

export type ChangeResult = { ok: true; change: number } | { ok: false; error: Message }

/**
 * Change owed for a cash sale.
 *
 * Returns a typed result rather than a negative number, so an under-payment surfaces as a
 * message at the counter instead of a nonsensical negative change that someone might
 * actually hand over.
 */
export function changeDue(total: number, tendered: number): ChangeResult {
  if (!Number.isInteger(total) || !Number.isInteger(tendered)) {
    return { ok: false, error: message('validation.wholeSen') }
  }
  if (tendered < total) {
    return { ok: false, error: message('validation.tenderedTooLittle') }
  }
  return { ok: true, change: tendered - total }
}

export type CartValidation = { ok: true } | { ok: false; error: Message }

/** Guards the submit button: an empty or malformed cart must never reach Firestore. */
export function validateCart(cart: Cart): CartValidation {
  if (cart.length === 0) {
    return { ok: false, error: message('validation.cartEmpty') }
  }
  if (cart.length > MAX_CART_LINES) {
    return { ok: false, error: message('validation.cartTooManyLines', { max: MAX_CART_LINES }) }
  }
  for (const line of cart) {
    if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) {
      return { ok: false, error: message('validation.linePrice', { name: line.name }) }
    }
    if (!Number.isInteger(line.basePrice) || line.basePrice < 0) {
      return { ok: false, error: message('validation.linePrice', { name: line.name }) }
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      return { ok: false, error: message('validation.lineQuantity', { name: line.name }) }
    }
    // The charged price must be exactly what the recorded options add up to. A line that
    // disagreed with its own snapshot would produce a receipt the customer could not check.
    if (line.unitPrice !== Math.max(0, line.basePrice + modifiersTotal(line.modifiers))) {
      return { ok: false, error: message('validation.linePriceInconsistent', { name: line.name }) }
    }
  }
  return { ok: true }
}
