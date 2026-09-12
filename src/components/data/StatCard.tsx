import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { cn } from '@/lib/utils'

/**
 * How a figure is read, not what it means.
 *
 * `money` is for figures in ringgit and `count` for quantities — the distinction exists
 * because a row mixing "RM 318.90" with "12" reads as one undifferentiated wall otherwise,
 * and the eye needs to know which kind of number it is looking at before it reads the label.
 */
export type StatTone = 'money' | 'count' | 'warning'

/**
 * How loudly the card is drawn.
 *
 * Three levels rather than one, because a screen where every figure is an identical white
 * rounded rectangle makes the reader do the sorting the design should have done for them:
 *
 *   * `hero` — the one figure a band is about. Larger, tinted, and alone at that weight.
 *   * `default` — the supporting figures of the same band.
 *   * `quiet` — context. Readable and visibly not the point: no shadow and no white surface
 *     of its own, so it recedes into the page instead of competing with the hero.
 */
export type StatVariant = 'hero' | 'default' | 'quiet'

const TONE_VALUE: Record<StatTone, string> = {
  money: 'text-foreground',
  count: 'text-foreground',
  // Not red: money still to collect is ordinary trading, not an error. Amber says "look at
  // this" without saying "something is broken".
  warning: 'text-primary',
}

const VARIANT_SHELL: Record<StatVariant, string> = {
  hero: 'border-primary/25 bg-primary/[0.04] p-5 shadow-xs',
  default: 'border-border bg-card p-4 shadow-xs',
  quiet: 'border-transparent bg-muted/60 p-4 shadow-none',
}

const VARIANT_VALUE: Record<StatVariant, string> = {
  hero: 'text-3xl sm:text-4xl',
  default: 'text-xl sm:text-2xl',
  quiet: 'text-lg sm:text-xl',
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'count',
  variant = 'default',
  icon,
  to,
  testId,
  dataStatus,
  className,
}: {
  label: string
  /** Pre-formatted: this component never does arithmetic or currency formatting. */
  value: string
  hint?: string
  tone?: StatTone
  variant?: StatVariant
  icon?: ReactNode
  /** Makes the whole card a link, so a figure that raises a question leads to the answer. */
  to?: string
  testId?: string
  dataStatus?: string
  className?: string
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {icon && (
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-md',
              variant === 'hero' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
            )}
          >
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </div>
      <span
        className={cn(
          // tabular-nums so a column of figures lines up digit for digit.
          'font-semibold tabular-nums break-words',
          VARIANT_VALUE[variant],
          TONE_VALUE[tone],
        )}
        data-testid={testId}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </>
  )

  const shell = cn(
    'flex flex-col gap-1 rounded-xl border transition-[box-shadow,border-color,background-color] duration-150',
    VARIANT_SHELL[variant],
    // Only a card that goes somewhere reacts to a pointer. A hover state on something
    // unclickable is a promise the interface does not keep.
    to &&
      'hover:border-primary/40 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
    className,
  )

  if (to) {
    return (
      <Link to={to} className={shell} data-status={dataStatus}>
        {body}
      </Link>
    )
  }

  return (
    <div className={shell} data-status={dataStatus}>
      {body}
    </div>
  )
}
