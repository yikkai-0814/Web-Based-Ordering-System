import type { Timestamp } from 'firebase/firestore'

import { isFulfillmentStatus, type FulfillmentStatus } from '@/features/pos/fulfillment'
import { isOrderType, type OrderType } from '@/features/pos/order-type'

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

/** A sale. Immutable once written — see firestore.rules. */
export interface Order {
  id: string
  number: number
  businessDate: string
  lines: OrderLine[]
  total: number
  /**
   * How the order is served, and the table it belongs to when it is eaten in.
   *
   * `tableNumber` is non-null only for `dine_in` — the rules refuse a takeaway that carries
   * one at all. It is an identifier and nothing more: several orders may share a table, and
   * nothing here tracks whether a table is occupied.
   *
   * Both are null on orders placed before order types existed. Orders are immutable, so
   * those cannot be backfilled, and guessing a type would invent history that never
   * happened — `orderTypeSummaryOf` renders them as "Not recorded".
   */
  orderType: OrderType | null
  tableNumber: string | null
  /**
   * **Legacy only.** Sales rung up before payment could be recorded separately captured it
   * at creation and carry the method here; the rules now forbid a new order from carrying
   * these three fields at all, so they are null on everything written since.
   *
   * Do not read them directly to decide whether an order is paid — `resolvePaymentState`
   * in payments.ts is the one place that answers that, and it consults the order's payment
   * document first.
   */
  paymentMethod: PaymentMethod | null
  cashTendered: number | null
  changeGiven: number | null
  createdAt: Timestamp | null
  /** The signed-in Firebase account — which credential rang this up. Never the operator. */
  createdBy: string
  createdByName: string
  /**
   * The POS staff identity that operated the till, and their name at the time of sale.
   *
   * Optional because orders written before staff identities existed have neither, and
   * orders are immutable so they cannot be backfilled. `operatorNameOf` handles the
   * fallback; nothing else should read these fields directly for display.
   */
  staffId: string | null
  staffName: string | null
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

/**
 * The business date `days` away from another one, as `YYYY-MM-DD`.
 *
 * The parts are parsed by hand and rebuilt through a **local** `Date`, never by handing the
 * string to `new Date()` — which reads a bare `YYYY-MM-DD` as UTC midnight and would land on
 * the wrong day for anyone west of Greenwich. That is the same trap `businessDateOf` avoids
 * by not using `toISOString()`, and the two must agree or the workspace could step onto a
 * date the till would never file a sale under.
 *
 * Going through `Date` rather than adding to the day number is what makes month ends and
 * leap years come out right. An unparseable input is returned unchanged rather than throwing
 * — a date picker is not worth crashing a till over.
 */
export function shiftBusinessDate(businessDate: string, days: number): string {
  const parts = businessDate.split('-').map(Number)
  const [year, month, day] = parts
  if (parts.length !== 3 || year === undefined || month === undefined || day === undefined) {
    return businessDate
  }
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return businessDate
  }

  const shifted = new Date(year, month - 1, day)
  if (Number.isNaN(shifted.getTime())) return businessDate
  shifted.setDate(shifted.getDate() + days)
  return businessDateOf(shifted)
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
    orderType,
    tableNumber,
    paymentMethod,
    cashTendered,
    changeGiven,
    createdAt,
    createdBy,
    createdByName,
    staffId,
    staffName,
  } = data

  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) return null
  if (typeof businessDate !== 'string' || businessDate.length !== 10) return null
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return null
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
    // Coerced, never fatal: an order placed before order types existed has neither field,
    // and discarding it would hide every pre-Phase-7 sale from the list and the reports.
    // An unrecognised value is treated the same as absent, exactly as paymentMethod is.
    orderType: isOrderType(orderType) ? orderType : null,
    tableNumber: typeof tableNumber === 'string' && tableNumber !== '' ? tableNumber : null,
    // Absent on every order written since payment became a separate step, and an
    // unrecognised value is treated the same as absent rather than discarding the sale.
    paymentMethod: isPaymentMethod(paymentMethod) ? paymentMethod : null,
    cashTendered: tendered,
    changeGiven: change,
    createdAt: (createdAt as Timestamp | undefined) ?? null,
    createdBy: typeof createdBy === 'string' ? createdBy : '',
    createdByName: typeof createdByName === 'string' ? createdByName : 'Unknown',
    staffId: typeof staffId === 'string' && staffId !== '' ? staffId : null,
    staffName: typeof staffName === 'string' && staffName !== '' ? staffName : null,
  }
}

/**
 * Who to show as having taken the order.
 *
 * Prefers the staff identity that operated the till, falling back to the account name for
 * orders written before staff identities existed. Never returns an empty string.
 */
export function operatorNameOf(order: Pick<Order, 'staffName' | 'createdByName'>): string {
  return preferOperatorName(order.staffName, order.createdByName)
}

/**
 * The shared rule behind `operatorNameOf` and `paymentOperatorNameOf`: show the person, fall
 * back to the account that was signed in, and never return an empty string.
 *
 * One definition rather than two, because an order and its payment answer the same question
 * — who was at the till — and they must not drift into answering it differently.
 */
function preferOperatorName(staffName: string | null, accountName: string): string {
  const staff = staffName?.trim()
  if (staff) return staff
  const account = accountName.trim()
  return account === '' ? 'Unknown' : account
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

/**
 * Money received for an order.
 *
 * Stored in `orderPayments/{orderId}` — its own document, keyed by the order it settles,
 * for exactly the reasons a void is (see `OrderVoid` and firestore.rules). Orders are
 * immutable, so payment cannot be a flag on one, and keying by the order id means the same
 * order cannot be paid twice: the second write is an update, which is refused.
 *
 * `amount` is the order total being settled, and the rules enforce that it matches the
 * order. Cash carries the tendered figure and the change handed back; e-wallet carries
 * neither, because nothing was counted out.
 */
export interface OrderPayment {
  orderId: string
  method: PaymentMethod
  amount: number
  cashTendered: number | null
  changeGiven: number | null
  paidAt: Timestamp | null
  /** The signed-in Firebase account that recorded it — which credential took the money. */
  paidBy: string
  paidByName: string
  /**
   * The POS operator who took the money, and their name at that moment.
   *
   * The same two-part accountability an order carries, for the same reason: one shared
   * login serves the whole shift, so the account cannot say who was at the counter. The
   * rules verify at write time that this identity exists, is active, and that the name
   * matches theirs right now — so the snapshot is provably accurate, and payments being
   * immutable means a later rename cannot rewrite it.
   *
   * Null only on a payment written before operator attribution was recorded; payments are
   * immutable, so those cannot be backfilled. `paymentOperatorNameOf` handles the fallback.
   */
  paidByStaffId: string | null
  paidByStaffName: string | null
}

/**
 * Who to show as having taken the money.
 *
 * Prefers the operator, falling back to the account name. The twin of `operatorNameOf`, and
 * built on the same rule so a receipt cannot name one person for the sale and a different
 * one for the payment purely because of how the two are stored.
 */
export function paymentOperatorNameOf(
  payment: Pick<OrderPayment, 'paidByStaffName' | 'paidByName'>,
): string {
  return preferOperatorName(payment.paidByStaffName, payment.paidByName)
}

export function parseOrderPayment(
  orderId: string,
  data: Record<string, unknown>,
): OrderPayment | null {
  const {
    method,
    amount,
    cashTendered,
    changeGiven,
    paidAt,
    paidBy,
    paidByName,
    paidByStaffId,
    paidByStaffName,
  } = data

  // A payment whose method is unrecognised cannot be displayed honestly, and one with a
  // nonsense amount would misreport the takings — both are skipped rather than rendered.
  if (!isPaymentMethod(method)) return null
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) return null

  const tendered =
    typeof cashTendered === 'number' && Number.isInteger(cashTendered) ? cashTendered : null
  const change =
    typeof changeGiven === 'number' && Number.isInteger(changeGiven) ? changeGiven : null

  return {
    orderId,
    method,
    amount,
    cashTendered: tendered,
    changeGiven: change,
    paidAt: (paidAt as Timestamp | undefined) ?? null,
    paidBy: typeof paidBy === 'string' ? paidBy : '',
    paidByName: typeof paidByName === 'string' ? paidByName : 'Unknown',
    paidByStaffId: typeof paidByStaffId === 'string' && paidByStaffId !== '' ? paidByStaffId : null,
    paidByStaffName:
      typeof paidByStaffName === 'string' && paidByStaffName !== '' ? paidByStaffName : null,
  }
}

/**
 * How far an order has got through being made and handed over.
 *
 * Stored in `orderFulfillment/{orderId}` — its own document, keyed by the order it tracks,
 * for the same reason a void and a payment are: orders are immutable, and putting a status
 * on one would mean granting update permission, which would reopen every field on every
 * sale to whoever works the kitchen.
 *
 * Unlike those two, this document is **updatable** — fulfilment is the one thing about an
 * order that legitimately progresses. The rules make that safe by validating the transition
 * rather than the value: one step forward at a time, and never onto a voided order. The
 * ABSENCE of this document means `pending`, so a newly placed order needs no write at all.
 *
 * `status` is deliberately not a union with payment: see fulfillment.ts.
 */
export interface OrderFulfillment {
  orderId: string
  status: FulfillmentStatus
  updatedAt: Timestamp | null
  /** The signed-in Firebase account that last moved it — which credential. */
  updatedBy: string
  updatedByName: string
  /**
   * The POS operator who made the MOST RECENT move, and their name at that moment.
   *
   * The same two-part accountability an order and a payment carry, for the same reason: one
   * shared login serves the whole shift, so the account cannot say who was at the counter.
   *
   * This pair is overwritten by each transition, which is why it is not the whole story —
   * `fulfillmentTransitionsOf` reads the append-only journal beneath this document for who
   * did each individual step. Null only on a record written before operator attribution
   * existed.
   */
  updatedByStaffId: string | null
  updatedByStaffName: string | null
}

/**
 * One step along the progression, as it happened.
 *
 * Stored in `orderFulfillment/{orderId}/transitions/{transitionId}` — append-only, and never
 * updated or deleted. The parent document holds only the CURRENT status and whoever moved it
 * last, so without this journal Bob marking an order ready would erase the fact that Alice
 * started preparing it. Who did which step is exactly the thing operator identities exist to
 * answer, so it cannot be allowed to overwrite itself.
 *
 * The same shape as `menuItemCosts` (current value) alongside `menuItemCostHistory`
 * (append-only journal), and written in the SAME batch as the parent so the two cannot
 * disagree.
 */
export interface FulfillmentTransition {
  id: string
  orderId: string
  from: FulfillmentStatus
  to: FulfillmentStatus
  at: Timestamp | null
  updatedBy: string
  updatedByName: string
  updatedByStaffId: string | null
  updatedByStaffName: string | null
}

/**
 * Who to show as having made a fulfilment step.
 *
 * Prefers the operator, falling back to the account name. The triplet of `operatorNameOf`
 * and `paymentOperatorNameOf`, built on the same rule so all three answer "who was at the
 * till" identically.
 */
export function fulfillmentOperatorNameOf(
  record: Pick<OrderFulfillment, 'updatedByStaffName' | 'updatedByName'>,
): string {
  return preferOperatorName(record.updatedByStaffName, record.updatedByName)
}

export function parseFulfillmentTransition(
  id: string,
  orderId: string,
  data: Record<string, unknown>,
): FulfillmentTransition | null {
  const { from, to, at, updatedBy, updatedByName, updatedByStaffId, updatedByStaffName } = data

  // A step that does not name two real statuses cannot be placed on the progression.
  if (!isFulfillmentStatus(from) || !isFulfillmentStatus(to)) return null

  return {
    id,
    orderId,
    from,
    to,
    at: (at as Timestamp | undefined) ?? null,
    updatedBy: typeof updatedBy === 'string' ? updatedBy : '',
    updatedByName: typeof updatedByName === 'string' ? updatedByName : 'Unknown',
    updatedByStaffId:
      typeof updatedByStaffId === 'string' && updatedByStaffId !== '' ? updatedByStaffId : null,
    updatedByStaffName:
      typeof updatedByStaffName === 'string' && updatedByStaffName !== ''
        ? updatedByStaffName
        : null,
  }
}

export function parseOrderFulfillment(
  orderId: string,
  data: Record<string, unknown>,
): OrderFulfillment | null {
  const { status, updatedAt, updatedBy, updatedByName, updatedByStaffId, updatedByStaffName } = data

  // An unrecognised status cannot be placed on the progression, so the record is skipped and
  // the order falls back to its resolved default rather than rendering a state that is not
  // one of the four.
  if (!isFulfillmentStatus(status)) return null

  return {
    orderId,
    status,
    updatedAt: (updatedAt as Timestamp | undefined) ?? null,
    updatedBy: typeof updatedBy === 'string' ? updatedBy : '',
    updatedByName: typeof updatedByName === 'string' ? updatedByName : 'Unknown',
    updatedByStaffId:
      typeof updatedByStaffId === 'string' && updatedByStaffId !== '' ? updatedByStaffId : null,
    updatedByStaffName:
      typeof updatedByStaffName === 'string' && updatedByStaffName !== ''
        ? updatedByStaffName
        : null,
  }
}

/** Newest first — what a till operator wants to see at the top of the day's list. */
export function byNumberDescending(a: Order, b: Order): number {
  if (a.businessDate !== b.businessDate) return b.businessDate.localeCompare(a.businessDate)
  return b.number - a.number
}
