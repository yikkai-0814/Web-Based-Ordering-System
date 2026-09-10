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
 */

export interface CartLine {
  menuItemId: string
  /** Snapshotted at the moment the line was added — see addToCart. */
  name: string
  /** Whole sen, snapshotted at the moment the line was added. */
  unitPrice: number
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
  unitPrice: number
}

/**
 * Adds one of an item, or increments the existing line for it.
 *
 * The line keeps the `name` and `unitPrice` captured the first time the item was added. If
 * an admin edits the price on another device while a customer is mid-order, the cart holds
 * the figure the customer was actually quoted — a receipt should never disagree with what
 * was said at the counter.
 */
export function addToCart(cart: Cart, item: AddToCartItem): Cart {
  const existing = cart.find((line) => line.menuItemId === item.menuItemId)

  if (existing) {
    if (existing.quantity >= MAX_LINE_QUANTITY) return cart
    return cart.map((line) =>
      line.menuItemId === item.menuItemId ? { ...line, quantity: line.quantity + 1 } : line,
    )
  }

  if (cart.length >= MAX_CART_LINES) return cart

  return [
    ...cart,
    {
      menuItemId: item.menuItemId,
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: 1,
    },
  ]
}

/** Sets an explicit quantity. Zero or less removes the line entirely. */
export function setQuantity(cart: Cart, menuItemId: string, quantity: number): Cart {
  if (quantity <= 0) return removeLine(cart, menuItemId)
  const capped = Math.min(Math.floor(quantity), MAX_LINE_QUANTITY)
  return cart.map((line) => (line.menuItemId === menuItemId ? { ...line, quantity: capped } : line))
}

export function incrementLine(cart: Cart, menuItemId: string): Cart {
  const line = cart.find((candidate) => candidate.menuItemId === menuItemId)
  if (!line) return cart
  return setQuantity(cart, menuItemId, line.quantity + 1)
}

/** Decrements by one; dropping to zero removes the line, which is what a till should do. */
export function decrementLine(cart: Cart, menuItemId: string): Cart {
  const line = cart.find((candidate) => candidate.menuItemId === menuItemId)
  if (!line) return cart
  return setQuantity(cart, menuItemId, line.quantity - 1)
}

export function removeLine(cart: Cart, menuItemId: string): Cart {
  return cart.filter((line) => line.menuItemId !== menuItemId)
}

export function clearCart(): Cart {
  return EMPTY_CART
}

/** Whole sen. Integer maths throughout, so this is exact at any cart size. */
export function lineTotal(line: CartLine): number {
  return line.unitPrice * line.quantity
}

export function cartTotal(cart: Cart): number {
  return cart.reduce((sum, line) => sum + lineTotal(line), 0)
}

/** Total number of physical items, for the "N items" badge. */
export function cartItemCount(cart: Cart): number {
  return cart.reduce((count, line) => count + line.quantity, 0)
}

export type ChangeResult = { ok: true; change: number } | { ok: false; error: string }

/**
 * Change owed for a cash sale.
 *
 * Returns a typed result rather than a negative number, so an under-payment surfaces as a
 * message at the counter instead of a nonsensical negative change that someone might
 * actually hand over.
 */
export function changeDue(total: number, tendered: number): ChangeResult {
  if (!Number.isInteger(total) || !Number.isInteger(tendered)) {
    return { ok: false, error: 'Amounts must be whole sen.' }
  }
  if (tendered < total) {
    return { ok: false, error: 'The amount tendered is less than the total.' }
  }
  return { ok: true, change: tendered - total }
}

export type CartValidation = { ok: true } | { ok: false; error: string }

/** Guards the submit button: an empty or malformed cart must never reach Firestore. */
export function validateCart(cart: Cart): CartValidation {
  if (cart.length === 0) {
    return { ok: false, error: 'Add at least one item before taking payment.' }
  }
  if (cart.length > MAX_CART_LINES) {
    return { ok: false, error: `An order cannot have more than ${MAX_CART_LINES} lines.` }
  }
  for (const line of cart) {
    if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) {
      return { ok: false, error: `"${line.name}" has an invalid price.` }
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      return { ok: false, error: `"${line.name}" has an invalid quantity.` }
    }
  }
  return { ok: true }
}
