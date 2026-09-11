import { cn } from '@/lib/utils'

/**
 * How much attention a status deserves, not what colour it is.
 *
 * Named by meaning so the palette can change in one place, and so a call site cannot quietly
 * make "unpaid" look reassuring.
 */
export type StatusTone = 'neutral' | 'active' | 'good' | 'warn'

const TONES: Record<StatusTone, string> = {
  // Nothing is happening yet.
  neutral: 'bg-muted text-muted-foreground',
  // Work in progress — visible, but not a problem.
  active: 'bg-primary/10 text-primary ring-1 ring-primary/25',
  // Finished, and nothing is owed.
  good: 'bg-muted text-muted-foreground',
  // Somebody needs to do something about this.
  warn: 'bg-destructive/10 text-destructive ring-1 ring-destructive/30',
}

/**
 * One badge for every status this app shows — fulfilment, payment, and the overall state.
 *
 * Shared deliberately: three statuses appear side by side on a single row, and three
 * independently styled components would drift until the row stopped reading as one thing.
 *
 * **Colour is never the only signal.** Every badge carries the word as well, so the state is
 * legible to anyone who cannot separate the hues, and on a sunlit counter display.
 */
export function StatusBadge({
  label,
  tone,
  testId,
  value,
  className,
}: {
  label: string
  tone: StatusTone
  /** For tests, so assertions key on the state rather than the display text. */
  testId?: string
  value?: string
  className?: string
}) {
  return (
    <span
      data-testid={testId}
      data-status={value}
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {label}
    </span>
  )
}
