import { useTranslation } from '@/features/i18n/useTranslation'
import { Clock } from 'lucide-react'

import {
  elapsedMsOf,
  elapsedWindowOf,
  ELAPSED_FINAL_LABEL_KEY,
  ELAPSED_LABEL_KEY,
  formatDuration,
  isElapsedFinished,
  type DeliverableFulfillment,
  type TimeableOrder,
} from '@/features/pos/fulfillment'
import { cn } from '@/lib/utils'
import { useNow } from '@/lib/useNow'

/**
 * How long the customer has been waiting: the order's creation until it is handed over.
 *
 * It starts the moment the sale exists and stops at exactly one moment — delivery. Not when
 * somebody presses "Start preparing", not when the kitchen marks it ready, and emphatically
 * not when it is paid for. An order sitting finished on the pass is still an order the
 * customer has not been given, which is the wait a kitchen board most needs to show.
 *
 * Split into two components rather than one with a conditional hook: only the running form
 * subscribes to the ticking clock, so a board of delivered orders re-renders for nothing.
 * Switching between them remounts, which is correct — they hold different state.
 */
export function OrderElapsedTime({
  order,
  fulfillment,
  size = 'compact',
  className,
}: {
  order: TimeableOrder | null
  /** The fulfilment sidecar, or null while the order is still the implicit `pending`. */
  fulfillment: DeliverableFulfillment | null
  /**
   * `prominent` is the queue board, where this is the number staff scan a column for.
   * `compact` is everywhere the duration is one detail among many.
   */
  size?: 'compact' | 'prominent'
  className?: string
}) {
  const delivered = isElapsedFinished(elapsedWindowOf(order, fulfillment))

  return delivered ? (
    <FinalElapsedTime order={order} fulfillment={fulfillment} size={size} className={className} />
  ) : (
    <RunningElapsedTime order={order} size={size} className={className} />
  )
}

function RunningElapsedTime({
  order,
  size,
  className,
}: {
  order: TimeableOrder | null
  size: 'compact' | 'prominent'
  className?: string
}) {
  const now = useNow(1000)
  return (
    <ElapsedReadout
      elapsed={elapsedMsOf(elapsedWindowOf(order, null), now)}
      running
      size={size}
      className={className}
    />
  )
}

function FinalElapsedTime({
  order,
  fulfillment,
  size,
  className,
}: {
  order: TimeableOrder | null
  fulfillment: DeliverableFulfillment | null
  size: 'compact' | 'prominent'
  className?: string
}) {
  // Date.now() is unused once the window has closed — the value is fixed at deliveredAt.
  return (
    <ElapsedReadout
      elapsed={elapsedMsOf(elapsedWindowOf(order, fulfillment), 0)}
      running={false}
      size={size}
      className={className}
    />
  )
}

function ElapsedReadout({
  elapsed,
  running,
  size,
  className,
}: {
  elapsed: number | null
  running: boolean
  size: 'compact' | 'prominent'
  className?: string
}) {
  const { t } = useTranslation()

  // Null only while a just-placed order's createdAt is an unresolved server timestamp in the
  // local cache. A frame or two later it fills in; a "0:00" in the meantime would be a claim.
  if (elapsed === null) return null

  const label = t(running ? ELAPSED_LABEL_KEY : ELAPSED_FINAL_LABEL_KEY)

  return (
    <span
      // The icon is not the label. Naming the element is what makes the number mean
      // something to a screen reader, and to anyone who reads a bare duration as a guess.
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center gap-1.5 tabular-nums',
        size === 'prominent'
          ? // Big enough to read across a counter, and given a tinted pill so the eye finds
            // it without it competing with the order number or the action button.
            'rounded-md bg-muted px-2 py-1 text-base font-semibold text-foreground'
          : 'text-xs text-muted-foreground',
        // A delivered order is history: the same number, stated more quietly.
        !running && 'font-medium text-muted-foreground',
        className,
      )}
      data-testid="order-elapsed"
      data-running={running ? 'true' : 'false'}
    >
      <Clock
        aria-hidden="true"
        className={cn('shrink-0', size === 'prominent' ? 'size-4' : 'size-3.5')}
      />
      <time data-testid="order-elapsed-duration">{formatDuration(elapsed)}</time>
    </span>
  )
}
