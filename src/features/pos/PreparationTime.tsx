import {
  formatDuration,
  isPreparationFinished,
  preparationElapsedMs,
  preparationWindowOf,
  PREPARATION_LABEL,
  type FinishableFulfillment,
  type TimeableOrder,
} from '@/features/pos/fulfillment'
import { cn } from '@/lib/utils'
import { useNow } from '@/lib/useNow'

/**
 * How long an order has taken, from being rung up to being marked ready.
 *
 * It starts the moment the sale exists — not when somebody presses "Start preparing", and
 * emphatically not when it is paid for. A ticket that waits five minutes before anyone
 * touches it has still kept the customer waiting five minutes, and that is the number worth
 * showing on a kitchen board.
 *
 * Always labelled. A bare `12:30` on an order card would be read as any number of things.
 *
 * Split into two components rather than one with a conditional hook: only the running form
 * subscribes to the ticking clock, so a board of finished orders re-renders for nothing.
 * Switching between them remounts, which is correct — they hold different state.
 */
export function PreparationTime({
  order,
  fulfillment,
  className,
}: {
  order: TimeableOrder | null
  /** The fulfilment sidecar, or null while the order is still the implicit `pending`. */
  fulfillment: FinishableFulfillment | null
  className?: string
}) {
  // Running until a finish has been recorded. Nothing else stops it: not the fulfilment
  // status, not payment, not who is looking at it.
  const finished = isPreparationFinished(preparationWindowOf(order, fulfillment))

  return finished ? (
    <FinishedPreparationTime order={order} fulfillment={fulfillment} className={className} />
  ) : (
    <RunningPreparationTime order={order} className={className} />
  )
}

function RunningPreparationTime({
  order,
  className,
}: {
  order: TimeableOrder | null
  className?: string
}) {
  const now = useNow(1000)
  const elapsed = preparationElapsedMs(preparationWindowOf(order, null), now)
  return <PreparationReadout elapsed={elapsed} running className={className} />
}

function FinishedPreparationTime({
  order,
  fulfillment,
  className,
}: {
  order: TimeableOrder | null
  fulfillment: FinishableFulfillment | null
  className?: string
}) {
  // Date.now() is unused once the window has closed — the value is fixed at readyAt.
  const elapsed = preparationElapsedMs(preparationWindowOf(order, fulfillment), 0)
  return <PreparationReadout elapsed={elapsed} running={false} className={className} />
}

function PreparationReadout({
  elapsed,
  running,
  className,
}: {
  elapsed: number | null
  running: boolean
  className?: string
}) {
  // Null only while a just-placed order's createdAt is an unresolved server timestamp in the
  // local cache. A frame or two later it fills in; a "0:00" in the meantime would be a claim.
  if (elapsed === null) return null

  return (
    <span
      className={cn('text-xs tabular-nums text-muted-foreground', className)}
      data-testid="preparation-time"
      data-running={running ? 'true' : 'false'}
    >
      <span className="font-medium">{PREPARATION_LABEL}</span>{' '}
      <time data-testid="preparation-duration">{formatDuration(elapsed)}</time>
    </span>
  )
}
