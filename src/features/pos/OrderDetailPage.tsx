import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { AlertCircle, Ban, ChefHat } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/useAuth'
import { useStaffSession } from '@/features/staff/useStaffSession'
import { lineTotal } from '@/features/pos/cart'
import {
  canAdvanceFulfillment,
  FULFILLMENT_ACTIONS,
  type FulfillmentStatus,
} from '@/features/pos/fulfillment'
import { setFulfillment } from '@/features/pos/fulfillment-api'
import { ORDER_TYPE_LABELS } from '@/features/pos/order-type'
import { withManagerAuthorization } from '@/features/pos/manager-authorization'
import { recordPayment } from '@/features/pos/payment-api'
import { canRecordPayment } from '@/features/pos/payments'
import {
  FulfillmentStatusBadge,
  OverallStatusBadge,
  PaymentStatusBadge,
} from '@/features/pos/PaymentStatusBadge'
import { RecordPaymentDialog } from '@/features/pos/RecordPaymentDialog'
import {
  fulfillmentOperatorNameOf,
  operatorNameOf,
  paymentOperatorNameOf,
  voidInitiatorNameOf,
  PAYMENT_LABELS,
  type PaymentMethod,
} from '@/features/pos/types'
import { useOrderDetail } from '@/features/pos/useOrderDetail'
import { voidOrder } from '@/features/pos/void-api'
import { VoidOrderDialog, type ManagerCredentials } from '@/features/pos/VoidOrderDialog'
import { formatMoney } from '@/lib/money'

/**
 * On-screen receipt.
 *
 * Every figure shown comes from the order document itself, never from the current menu —
 * that is the whole point of snapshotting the line items. Repricing or deleting an item
 * afterwards leaves this receipt exactly as it was at the time of sale.
 */
export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const { profile, role } = useAuth()
  const { operator } = useStaffSession()
  // One order and its three sidecars, by id — never the whole collection. A receipt is
  // about exactly one sale, and this page used to load every order ever written to find it.
  const { view, loading } = useOrderDetail(orderId)
  const [advancing, setAdvancing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) {
    return <Skeleton className="h-96 w-full max-w-lg" />
  }

  if (!view) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Order not found</h1>
        <p className="text-muted-foreground">No sale matches that address.</p>
        <Button asChild size="lg" className="h-touch text-base">
          <Link to="/orders">Back to orders</Link>
        </Button>
      </div>
    )
  }

  // The two axes and the line derived from both, resolved by the very same helpers the
  // orders list and the queue use — so a receipt can never disagree with the row that led
  // here. Nothing among them is stored.
  const {
    order,
    fulfillment,
    fulfillmentRecord,
    payment: paymentState,
    paymentRecord: payment,
    voided,
    overall,
  } = view

  const isAdmin = role === 'admin'
  const eligibility = canRecordPayment({ state: paymentState, voided: voided !== null })
  const advance = canAdvanceFulfillment({ current: fulfillment, voided: voided !== null })

  /**
   * When the money actually changed hands. A payment recorded after the fact carries its
   * own `paidAt`; an order rung up before payment was a separate step was paid at the
   * moment it was created, so its `createdAt` is the honest answer rather than nothing.
   */
  const paidAt =
    paymentState.status === 'paid'
      ? paymentState.source === 'recorded'
        ? (payment?.paidAt ?? null)
        : order.createdAt
      : null

  /**
   * Which identity to record against a payment or a fulfilment step.
   *
   * The selected POS operator when there is one — the till always has one, because the
   * terminal will not sell until somebody says who is on it. Otherwise the signed-in
   * account's own identity, which the rules accept as the self-operator form and which is
   * always available to everyone.
   *
   * That fallback is what keeps this page usable for an admin working without picking an
   * operator first. Making either action wait on a selection would put a roster step in
   * front of taking money and in front of the kitchen, which is the wrong trade at a
   * counter.
   */
  const payer = operator ?? (profile ? { id: profile.uid, name: profile.displayName } : null)

  async function handleAdvance(from: FulfillmentStatus, to: FulfillmentStatus) {
    if (!profile || !order || !payer) return
    setError(null)
    setAdvancing(true)
    try {
      await setFulfillment(order.id, {
        from,
        to,
        user: { uid: profile.uid, displayName: profile.displayName },
        // The same identity a payment records: the selected operator, or the signed-in
        // account when nobody has been picked.
        staff: { id: payer.id, name: payer.name },
      })
    } catch (caught) {
      // A rules refusal says only 'permission-denied', which tells the counter nothing. The
      // realistic cause is a stale page: somebody else moved this order on another device.
      const denied = typeof caught === 'object' && caught !== null && 'code' in caught
      setError(
        denied
          ? 'That step could not be saved. Somebody may have already moved this order, or it has been voided.'
          : caught instanceof Error && caught.message
            ? caught.message
            : 'That step could not be saved.',
      )
    } finally {
      setAdvancing(false)
    }
  }

  async function handlePayment(method: PaymentMethod, cashTendered: number | null) {
    if (!profile || !order || !payer) return
    setError(null)
    try {
      await recordPayment(order.id, {
        method,
        amount: order.total,
        cashTendered,
        user: { uid: profile.uid, displayName: profile.displayName },
        staff: { id: payer.id, name: payer.name },
      })
    } catch (caught) {
      // A rules refusal arrives as a FirebaseError carrying only 'permission-denied', which
      // would tell the counter nothing. Translate it into the two things it can actually
      // mean, and let recordPayment's own validation messages through untouched.
      const denied = typeof caught === 'object' && caught !== null && 'code' in caught
      throw denied
        ? new Error(
            'That payment could not be recorded. The order may already be paid, or it may have been voided.',
          )
        : caught
    }
  }

  /**
   * Two routes to the same record.
   *
   * An admin writes it with their own session. Anyone else hands a manager's credentials to
   * `withManagerAuthorization`, which borrows that manager's authority for exactly one write
   * and gives it back — the till's session is never elevated, and `voidOrder` is the same
   * writer either way, so the two routes cannot produce differently shaped voids.
   *
   * Both record the operator at the till as the initiator, so an admin's own void answers
   * "who asked for this" with their own name rather than leaving it blank.
   */
  async function handleVoid(reason: string, credentials: ManagerCredentials | null) {
    if (!profile || !order || !operator) return
    setError(null)

    const initiatedBy = { staffId: operator.id, staffName: operator.name }

    try {
      if (credentials) {
        await withManagerAuthorization(credentials, (manager, firestore) =>
          voidOrder(
            order.id,
            {
              amount: order.total,
              reason,
              authorizedBy: manager,
              initiatedBy,
            },
            firestore,
          ),
        )
      } else {
        await voidOrder(order.id, {
          amount: order.total,
          reason,
          authorizedBy: { uid: profile.uid, displayName: profile.displayName },
          initiatedBy,
        })
      }
    } catch (caught) {
      // withManagerAuthorization already produces a sentence worth reading — a wrong
      // password, a throttled account, credentials that are not a manager's. Anything else
      // is a rules refusal, which needs one written here.
      const message =
        caught instanceof Error && caught.message
          ? caught.message
          : 'That sale could not be voided.'
      setError(message)
      throw new Error(message)
    }
  }

  return (
    <div className="space-y-4">
      {voided && (
        <Alert variant="destructive" className="w-full max-w-lg" data-testid="voided-banner">
          <Ban aria-hidden="true" />
          <AlertDescription>
            <span className="block font-medium">
              This sale was voided — {formatMoney(voided.amount)} reversed.
            </span>
            <span className="block">Reason: {voided.reason}</span>
            <span className="block text-xs">
              Requested by {voidInitiatorNameOf(voided)}, authorised by {voided.voidedByName}
              {voided.voidedAt ? ` on ${voided.voidedAt.toDate().toLocaleString()}` : ''}
            </span>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="w-full max-w-lg">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
            <span data-testid="receipt-number">Order #{order.number}</span>
            <OverallStatusBadge status={overall} />
          </CardTitle>
          <CardDescription>
            {order.businessDate} · served by{' '}
            <span data-testid="receipt-operator">{operatorNameOf(order)}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* How the order is served. The table row is omitted entirely for a takeaway —
              showing "Table —" would imply a table that was never involved. */}
          <dl className="grid gap-1 text-sm" data-testid="service-summary">
            <div className="flex gap-3">
              <dt className="text-muted-foreground">Order type</dt>
              <dd className="ml-auto" data-testid="receipt-order-type">
                {order.orderType === null ? 'Not recorded' : ORDER_TYPE_LABELS[order.orderType]}
              </dd>
            </div>
            {order.orderType === 'dine_in' && order.tableNumber !== null && (
              <div className="flex gap-3">
                <dt className="text-muted-foreground">Table</dt>
                <dd className="ml-auto" data-testid="receipt-table">
                  {order.tableNumber}
                </dd>
              </div>
            )}
          </dl>

          {/* Both axes spelled out, so nobody has to infer the state from a single word.
              The overall line is derived from the two above it, never stored. */}
          <dl className="grid gap-1 rounded-lg border p-3 text-sm" data-testid="status-summary">
            <div className="flex items-center gap-3">
              <dt className="text-muted-foreground">Fulfilment</dt>
              <dd className="ml-auto">
                <FulfillmentStatusBadge status={fulfillment} />
              </dd>
            </div>
            {/* Who made the most recent step. Earlier steps are not overwritten — they are
                kept in the transitions journal beneath this order's fulfilment record. */}
            {fulfillmentRecord && (
              <div className="flex items-center gap-3">
                <dt className="text-muted-foreground">Last moved by</dt>
                <dd className="ml-auto" data-testid="fulfillment-operator">
                  {fulfillmentOperatorNameOf(fulfillmentRecord)}
                </dd>
              </div>
            )}
            <div className="flex items-center gap-3">
              <dt className="text-muted-foreground">Payment</dt>
              <dd className="ml-auto">
                <PaymentStatusBadge state={paymentState} />
              </dd>
            </div>
            <div className="flex items-center gap-3 border-t pt-1">
              <dt className="font-medium">Overall</dt>
              <dd className="ml-auto">
                <OverallStatusBadge status={overall} />
              </dd>
            </div>
          </dl>

          <ul className="divide-y">
            {order.lines.map((line) => (
              <li
                key={line.menuItemId}
                className="flex items-baseline gap-3 py-2"
                data-testid="receipt-line"
                data-item-name={line.name}
              >
                <span className="w-8 tabular-nums text-muted-foreground">{line.quantity}×</span>
                <span className="min-w-0 flex-1 truncate">{line.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatMoney(line.unitPrice)}
                </span>
                <span className="w-24 text-right tabular-nums">{formatMoney(lineTotal(line))}</span>
              </li>
            ))}
          </ul>

          <div className="flex items-baseline gap-3 border-t pt-3">
            <span className="text-base font-medium">Total</span>
            <span
              className="ml-auto text-2xl font-semibold tabular-nums"
              data-testid="receipt-total"
            >
              {formatMoney(order.total)}
            </span>
          </div>

          {paymentState.status === 'paid' ? (
            <dl className="grid gap-1 text-sm">
              <div className="flex gap-3">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="ml-auto font-medium">Paid</dd>
              </div>
              <div className="flex gap-3">
                <dt className="text-muted-foreground">Payment method</dt>
                <dd className="ml-auto" data-testid="receipt-method">
                  {PAYMENT_LABELS[paymentState.method]}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="text-muted-foreground">Paid at</dt>
                <dd className="ml-auto" data-testid="receipt-paid-at">
                  {paidAt ? paidAt.toDate().toLocaleString() : '—'}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="text-muted-foreground">Payment taken by</dt>
                {/* A legacy order was paid as it was rung up, so its own operator is who
                    took the money — there is no separate payment record to name. */}
                <dd className="ml-auto" data-testid="receipt-paid-by">
                  {payment ? paymentOperatorNameOf(payment) : operatorNameOf(order)}
                </dd>
              </div>
              {/* Cash is the only method that counts anything out, so these two lines exist
                  for cash alone rather than showing a meaningless zero for e-wallet. */}
              {paymentState.method === 'cash' && paymentState.cashTendered !== null && (
                <>
                  <div className="flex gap-3">
                    <dt className="text-muted-foreground">Cash received</dt>
                    <dd className="ml-auto tabular-nums" data-testid="receipt-tendered">
                      {formatMoney(paymentState.cashTendered)}
                    </dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="text-muted-foreground">Change</dt>
                    <dd className="ml-auto tabular-nums" data-testid="receipt-change">
                      {formatMoney(paymentState.changeGiven ?? 0)}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="receipt-unpaid">
              {voided
                ? 'This sale was voided before it was paid.'
                : 'This order has not been paid yet.'}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline" size="lg" className="h-touch text-base">
          <Link to="/orders">Back to orders</Link>
        </Button>

        {/* Moving the order along the kitchen workflow. Both roles, one step at a time, and
            only when the rules would accept it — a delivered or voided order gets no button.
            The label says what is about to happen, not the state being left. */}
        {advance.ok && FULFILLMENT_ACTIONS[fulfillment] && (
          <Button
            variant="outline"
            size="lg"
            className="h-touch text-base"
            data-testid="advance-fulfillment"
            data-next={advance.next}
            disabled={advancing}
            onClick={() => void handleAdvance(fulfillment, advance.next)}
          >
            <ChefHat aria-hidden="true" />
            {advancing ? 'Saving…' : FULFILLMENT_ACTIONS[fulfillment]}
          </Button>
        )}

        {/* Both roles: taking money is the job of whoever is on the till. Offered only when
            the rules would actually accept it — an already-paid or voided order gets no
            button, because showing one that is certain to be refused is a lie. */}
        {eligibility.ok && (
          <RecordPaymentDialog
            orderNumber={order.number}
            total={order.total}
            onConfirm={handlePayment}
          />
        )}

        {/* Open to everyone, because a staff member can now START a void — but only an
            admin's credentials can complete one, which the dialog asks for and the rules
            insist on. Already voided sales cannot be voided again: the rules would refuse it
            anyway, but offering the button would be a lie. */}
        {!voided && (
          <VoidOrderDialog
            orderNumber={order.number}
            amount={order.total}
            requiresAuthorization={!isAdmin}
            onConfirm={handleVoid}
          />
        )}
      </div>
    </div>
  )
}
