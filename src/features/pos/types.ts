import type { Timestamp } from 'firebase/firestore'

/**
 * The two ways the café takes money.
 *
 * `ewallet` covers every cashless method the vendor accepts — DuitNow QR and the various
 * wallet apps are one thing at the counter, so they are one value here rather than a
 * distinction nobody makes.
 *
 * **Recorded, not integrated.** Choosing it labels the sale; no payment gateway is
 * involved, and the system never confirms that money actually moved — the person at the
 * till does that on the customer's phone. Cash is the only method with arithmetic behind
 * it.
 */
export const PAYMENT_METHODS = ['cash', 'ewallet'] as const

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  ewallet: 'E-Wallet',
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value)
}

/**
 * A line as recorded on the order.
 *
 * `name` and `unitPrice` are **snapshots** taken at the time of sale. The order never
 * dereferences the menu item, which is what lets an item be renamed, repriced or deleted
 * without rewriting past receipts.
 */
export interface OrderLine {
  menuItemId: string
  name: string
  unitPrice: number
  quantity: number
}

/** A completed sale. Immutable once written — see firestore.rules. */
export interface Order {
  id: string
  number: number
  businessDate: string
  lines: OrderLine[]
  total: number
  paymentMethod: PaymentMethod
  cashTendered: number | null
  changeGiven: number | null
  createdAt: Timestamp | null
  createdBy: string
  createdByName: string
}

/**
 * The local calendar date a sale belongs to, as `YYYY-MM-DD`.
 *
 * Deliberately built from local date parts rather than `toISOString()`, which would use UTC
 * and could file an evening sale under tomorrow (or a morning one under yesterday)
 * depending on the timezone offset.
 */
export function businessDateOf(when: Date): string {
  const year = when.getFullYear()
  const month = String(when.getMonth() + 1).padStart(2, '0')
  const day = String(when.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLine(value: unknown): OrderLine | null {
  if (typeof value !== 'object' || value === null) return null
  const { menuItemId, name, unitPrice, quantity } = value as Record<string, unknown>
  if (typeof menuItemId !== 'string' || menuItemId === '') return null
  if (typeof name !== 'string' || name === '') return null
  if (typeof unitPrice !== 'number' || !Number.isInteger(unitPrice) || unitPrice < 0) return null
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) return null
  return { menuItemId, name, unitPrice, quantity }
}

/**
 * Validates an order document before the app trusts it, in the same spirit as
 * `parseUserProfile` and `parseMenuItem`. A malformed order is skipped rather than
 * rendered — a receipt showing `NaN` would be worse than one missing.
 */
export function parseOrder(id: string, data: Record<string, unknown>): Order | null {
  const {
    number,
    businessDate,
    lines,
    total,
    paymentMethod,
    cashTendered,
    changeGiven,
    createdAt,
    createdBy,
    createdByName,
  } = data

  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) return null
  if (typeof businessDate !== 'string' || businessDate.length !== 10) return null
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return null
  if (!isPaymentMethod(paymentMethod)) return null
  if (!Array.isArray(lines) || lines.length === 0) return null

  const parsedLines: OrderLine[] = []
  for (const line of lines) {
    const parsed = parseLine(line)
    if (!parsed) return null
    parsedLines.push(parsed)
  }

  const tendered =
    typeof cashTendered === 'number' && Number.isInteger(cashTendered) ? cashTendered : null
  const change =
    typeof changeGiven === 'number' && Number.isInteger(changeGiven) ? changeGiven : null

  return {
    id,
    number,
    businessDate,
    lines: parsedLines,
    total,
    paymentMethod,
    cashTendered: tendered,
    changeGiven: change,
    createdAt: (createdAt as Timestamp | undefined) ?? null,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    createdByName: typeof createdByName === 'string' ? createdByName : 'Unknown',
  }
}

/**
 * A cancelled sale.
 *
 * Stored in `orderVoids/{orderId}` — its own document, keyed by the order it cancels,
 * because orders are immutable and a void must not require update permission on them. See
 * firestore.rules. `amount` is the order total being reversed, and the rules enforce that
 * it matches the order.
 */
export interface OrderVoid {
  orderId: string
  reason: string
  amount: number
  voidedAt: Timestamp | null
  voidedBy: string
  voidedByName: string
}

export function parseOrderVoid(orderId: string, data: Record<string, unknown>): OrderVoid | null {
  const { reason, amount, voidedAt, voidedBy, voidedByName } = data

  if (typeof reason !== 'string' || reason.trim() === '') return null
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) return null

  return {
    orderId,
    reason,
    amount,
    voidedAt: (voidedAt as Timestamp | undefined) ?? null,
    voidedBy: typeof voidedBy === 'string' ? voidedBy : '',
    voidedByName: typeof voidedByName === 'string' ? voidedByName : 'Unknown',
  }
}

/** Newest first — what a till operator wants to see at the top of the day's list. */
export function byNumberDescending(a: Order, b: Order): number {
  if (a.businessDate !== b.businessDate) return b.businessDate.localeCompare(a.businessDate)
  return b.number - a.number
}
