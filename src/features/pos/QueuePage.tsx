import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AlertCircle, ChefHat } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/data/EmptyState'
import { useAuth } from '@/features/auth/useAuth'
import { useStaffSession } from '@/features/staff/useStaffSession'
import { BusinessDateBar } from '@/features/pos/BusinessDateBar'
import type { FulfillmentStatus } from '@/features/pos/fulfillment'
import { setFulfillment } from '@/features/pos/fulfillment-api'
import { orderTypeSummaryOf } from '@/features/pos/order-type'
import type { OrderView } from '@/features/pos/orders-view'
import { FulfillmentStatusBadge, PaymentStatusBadge } from '@/features/pos/PaymentStatusBadge'
import { PreparationTime } from '@/features/pos/PreparationTime'
import {
  groupQueue,
  itemCountOf,
  QUEUE_COLUMN_LABELS,
  queueActionFor,
  type QueueColumn,
} from '@/features/pos/queue'
import { fulfillmentOperatorNameOf, operatorNameOf, PAYMENT_LABELS } from '@/features/pos/types'
import { useShownBusinessDate } from '@/features/pos/useBusinessToday'
import { useOrdersWorkspace } from '@/features/pos/useOrdersWorkspace'
import { formatMoney } from '@/lib/money'

/**
 * The kitchen board: what still has to be made, and what has to be handed over.
 *
 * Three columns, oldest first, for one business date. Delivered orders leave the board — they
 * are still in the Orders workspace under `Delivered` and `Completed`, but a queue that
 * accumulated every finished order all day would bury the ones that need doing.
 *
 * The button on a card is `queueActionFor`, which is `canAdvanceFulfillment` and
 * `FULFILLMENT_ACTIONS` — the same helpers the receipt uses — and the write goes through the
 * same `setFulfillment` the receipt calls. There is no second workflow here, only a second
 * arrangement of the first. An invalid step is refused three times over: the button for it
 * never renders, `setFulfillment` throws before writing, and the security rules refuse the
 * write regardless of what the client believes.
 *
 * **Payment is shown but never actioned here.** An unpaid order is the one thing on a card
 * that somebody has to do something about, so hiding it would be wrong; taking the money is
 * the counter's job on the receipt, not the kitchen's.
 */
export function QueuePage() {
  // Follows today on its own, unless somebody has navigated to another day — see the hook.
  const { businessDate, showDate } = useShownBusinessDate()
  const { views, loading, error } = useOrdersWorkspace(businessDate)
  const { profile } = useAuth()
  const { operator } = useStaffSession()

  /**
   * The step each card currently has in flight, keyed by order id.
   *
   * The VALUE matters as much as the key. Firestore applies a write to its local cache
   * before the server has acknowledged it, so the listener moves the card to its new column
   * within a frame or two - at which point the card offers the NEXT step. Keying only by
   * order id would leave that next button greyed out until the acknowledgement came back,
   * which is precisely what made the board feel slow: the state was already correct on
   * screen and the button was still refusing to be pressed. Keyed by target, a card is busy
   * only for the exact step still in flight, and the step after it is available at once.
   *
   * It is still a guard: pressing the same button twice cannot send the same step twice.
   */
  const [inFlight, setInFlight] = useState<ReadonlyMap<string, FulfillmentStatus>>(() => new Map())
  const [moveError, setMoveError] = useState<string | null>(null)

  /**
   * The same map, kept in a ref because the guard has to be answered SYNCHRONOUSLY.
   *
   * A state updater is not guaranteed to run during the event that queued it, so deciding
   * "is this step already in flight?" from inside `setInFlight` would sometimes decide it
   * after the second click had already been let through. The ref is the authority; the
   * state exists only to re-render the button.
   */
  const inFlightRef = useRef<ReadonlyMap<string, FulfillmentStatus>>(inFlight)

  const columns = useMemo(() => groupQueue(views), [views])
  const queued = columns.reduce((count, column) => count + column.views.length, 0)

  /**
   * The identity recorded against the move: the selected POS operator, or the signed-in
   * account when nobody has been picked. Exactly what the receipt does, and the rules accept
   * both forms — which is what lets an admin work the board without choosing an operator
   * first.
   */
  const mover = operator ?? (profile ? { id: profile.uid, name: profile.displayName } : null)

  /** Marks a step in flight, or reports that the identical step already is. */
  function claim(orderId: string, to: FulfillmentStatus): boolean {
    if (inFlightRef.current.get(orderId) === to) return false
    const next = new Map(inFlightRef.current)
    next.set(orderId, to)
    inFlightRef.current = next
    setInFlight(next)
    return true
  }

  function release(orderId: string, to: FulfillmentStatus) {
    // Only if it is still OUR step: a later one may already have claimed the slot.
    if (inFlightRef.current.get(orderId) !== to) return
    const next = new Map(inFlightRef.current)
    next.delete(orderId)
    inFlightRef.current = next
    setInFlight(next)
  }

  /**
   * Moves a card, without making the board wait for the server.
   *
   * There is no hand-rolled optimistic copy of the queue here, and deliberately so.
   * Firestore already applies the write to its local cache immediately, so the snapshot
   * listener behind `useOrdersWorkspace` reports the new status within a frame - and if the
   * write is later refused, it rolls the local change back and the listener reports THAT
   * too. A second, hand-maintained copy of the same state could only ever disagree with
   * that rollback; the fix for the delay was to stop blocking the UI on the acknowledgement,
   * not to duplicate the state.
   *
   * So all this does is record the step as in flight, fire the write, and surface a failure.
   * The revert is Firestore's, and it is the same mechanism whether the refusal comes from
   * the rules, the network, or somebody else having moved the card first.
   */
  async function handleAdvance(view: OrderView, to: FulfillmentStatus) {
    if (!profile || !mover) return
    if (!claim(view.order.id, to)) return

    setMoveError(null)
    try {
      await setFulfillment(view.order.id, {
        from: view.fulfillment,
        to,
        user: { uid: profile.uid, displayName: profile.displayName },
        staff: { id: mover.id, name: mover.name },
      })
    } catch (caught) {
      // A rules refusal says only 'permission-denied', which tells the kitchen nothing. On a
      // shared board the realistic cause is that somebody else moved this card first. The
      // card itself has already snapped back by now - this only explains why.
      const denied = typeof caught === 'object' && caught !== null && 'code' in caught
      setMoveError(
        denied
          ? 'That step could not be saved. Somebody may have already moved this order, or it has been voided.'
          : caught instanceof Error && caught.message
            ? caught.message
            : 'That step could not be saved.',
      )
    } finally {
      release(view.order.id, to)
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Queue</h1>
        <p className="text-muted-foreground">
          Orders still to be made and handed over, oldest first. Each card moves one step: pending
          to preparing, preparing to ready, ready to delivered. A delivered or voided order leaves
          the board — it stays on the Orders page.
        </p>
      </div>

      <BusinessDateBar businessDate={businessDate} onChange={showDate} />

      {(error ?? moveError) && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error ?? moveError}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : queued === 0 ? (
        <div data-testid="queue-empty">
          <EmptyState
            title="Nothing waiting on this date"
            description="Every order has been delivered or voided. New orders appear here as they are rung up."
            icon={<ChefHat className="size-6" aria-hidden="true" />}
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {columns.map((column) => (
            <QueueColumnPanel
              key={column.status}
              status={column.status}
              views={column.views}
              inFlight={inFlight}
              onAdvance={handleAdvance}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function QueueColumnPanel({
  status,
  views,
  inFlight,
  onAdvance,
}: {
  status: QueueColumn
  views: OrderView[]
  inFlight: ReadonlyMap<string, FulfillmentStatus>
  onAdvance: (view: OrderView, to: FulfillmentStatus) => Promise<void>
}) {
  return (
    <section
      className="space-y-3 rounded-xl border bg-muted/40 p-3"
      aria-label={QUEUE_COLUMN_LABELS[status]}
      data-testid="queue-column"
      data-status={status}
    >
      <h2 className="flex items-baseline gap-2 text-sm font-semibold tracking-wide uppercase">
        {QUEUE_COLUMN_LABELS[status]}
        <span
          className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground"
          data-testid="queue-column-count"
        >
          {views.length}
        </span>
      </h2>

      {views.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          Nothing here.
        </p>
      ) : (
        <ul className="space-y-3">
          {views.map((view) => (
            <li key={view.order.id}>
              <QueueCard
                view={view}
                inFlightTo={inFlight.get(view.order.id) ?? null}
                onAdvance={onAdvance}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function QueueCard({
  view,
  inFlightTo,
  onAdvance,
}: {
  view: OrderView
  /** The step this card has in flight, if any - see `inFlight` on the page. */
  inFlightTo: FulfillmentStatus | null
  onAdvance: (view: OrderView, to: FulfillmentStatus) => Promise<void>
}) {
  const { order } = view
  const action = queueActionFor(view)
  // Busy only for the step actually in flight. Once the card has moved, the step it now
  // offers is a different one and is pressable immediately.
  const busy = action !== null && inFlightTo === action.next

  return (
    <article
      className="space-y-3 rounded-xl border bg-card p-3 shadow-xs transition-[box-shadow,border-color] duration-150 hover:border-primary/30 hover:shadow-sm"
      data-testid="queue-card"
      data-order-number={order.number}
      data-fulfillment={view.fulfillment}
    >
      <header className="flex flex-wrap items-baseline gap-2">
        <Link
          to={`/orders/${order.id}`}
          className="text-lg font-semibold tabular-nums hover:underline"
          aria-label={`Receipt for order ${order.number}`}
        >
          #{order.number}
        </Link>
        {/* "Dine-in · Table 5" or "Takeaway" — the table is the whole reason this is on the
            card, because it is how the food reaches the right person. */}
        <span className="text-sm font-medium" data-testid="queue-service">
          {orderTypeSummaryOf(order)}
        </span>
        <span className="ml-auto tabular-nums text-muted-foreground">
          {formatMoney(order.total)}
        </span>
      </header>

      <ul className="space-y-0.5 text-sm">
        {order.lines.map((line) => (
          <li
            key={line.menuItemId}
            className="flex items-baseline gap-2"
            data-testid="queue-line"
            data-item-name={line.name}
          >
            <span className="w-7 shrink-0 tabular-nums text-muted-foreground">
              {line.quantity}×
            </span>
            <span className="min-w-0 flex-1">{line.name}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
        <FulfillmentStatusBadge status={view.fulfillment} />
        <PaymentStatusBadge state={view.payment} />
        {view.payment.status === 'paid' && (
          <span className="text-xs text-muted-foreground">
            {PAYMENT_LABELS[view.payment.method]}
          </span>
        )}
        <span className="ml-auto tabular-nums text-muted-foreground">
          {itemCountOf(view)} {itemCountOf(view) === 1 ? 'item' : 'items'}
        </span>
      </div>

      {/* Runs from the moment the sale was rung up and freezes when it is marked ready.
          Neither the fulfilment status nor payment has any say in it, and nothing is
          written per second - see the preparation-timing block in fulfillment.ts. */}
      <PreparationTime order={order} fulfillment={view.fulfillmentRecord} className="block" />

      {/* Who rang it up, and — once somebody has touched it — who moved it last. The second
          line is why operator identities exist: a shared login cannot answer either. */}
      <p className="text-xs text-muted-foreground" data-testid="queue-operator">
        Taken by {operatorNameOf(order)}
        {view.fulfillmentRecord
          ? ` · last moved by ${fulfillmentOperatorNameOf(view.fulfillmentRecord)}`
          : ''}
      </p>

      {action && (
        <Button
          className="h-touch w-full text-base"
          size="lg"
          disabled={busy}
          data-testid="queue-advance"
          data-next={action.next}
          onClick={() => void onAdvance(view, action.next)}
        >
          <ChefHat aria-hidden="true" />
          {busy ? 'Saving…' : action.label}
        </Button>
      )}
    </article>
  )
}
