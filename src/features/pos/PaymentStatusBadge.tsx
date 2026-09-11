import {
  FULFILLMENT_LABELS,
  OVERALL_LABELS,
  type FulfillmentStatus,
  type OverallStatus,
} from '@/features/pos/fulfillment'
import { PAYMENT_STATUS_LABELS, type PaymentState } from '@/features/pos/payments'
import { StatusBadge, type StatusTone } from '@/features/pos/StatusBadge'

/**
 * PAID or UNPAID, loudly.
 *
 * An unpaid order is money not yet in the drawer, so it is the one thing on the row that has
 * to survive being glanced at across a busy counter.
 */
export function PaymentStatusBadge({
  state,
  className,
}: {
  state: PaymentState
  className?: string
}) {
  return (
    <StatusBadge
      label={PAYMENT_STATUS_LABELS[state.status]}
      tone={state.status === 'paid' ? 'good' : 'warn'}
      testId="payment-status"
      value={state.status}
      className={className}
    />
  )
}

const FULFILLMENT_TONES: Record<FulfillmentStatus, StatusTone> = {
  pending: 'neutral',
  // The two states that mean somebody is mid-task.
  preparing: 'active',
  ready: 'active',
  delivered: 'good',
}

/** How far through the kitchen an order is. Says nothing about money. */
export function FulfillmentStatusBadge({
  status,
  className,
}: {
  status: FulfillmentStatus
  className?: string
}) {
  return (
    <StatusBadge
      label={FULFILLMENT_LABELS[status]}
      tone={FULFILLMENT_TONES[status]}
      testId="fulfillment-status"
      value={status}
      className={className}
    />
  )
}

const OVERALL_TONES: Record<OverallStatus, StatusTone> = {
  voided: 'warn',
  completed: 'good',
  // The state this whole workflow exists to make visible: the customer has the food and
  // the money is not in the till. It must never look like "done".
  'payment-outstanding': 'warn',
  pending: 'neutral',
  preparing: 'active',
  ready: 'active',
}

/** Both axes in one word — the line somebody reads to know whether an order is finished. */
export function OverallStatusBadge({
  status,
  className,
}: {
  status: OverallStatus
  className?: string
}) {
  return (
    <StatusBadge
      label={OVERALL_LABELS[status]}
      tone={OVERALL_TONES[status]}
      testId="overall-status"
      value={status}
      className={className}
    />
  )
}
