import { cn } from '@/lib/utils'

/**
 * One labelled proportional bar.
 *
 * The bar is the *secondary* channel throughout: every row states its own figure in text,
 * and the width only makes the comparison between rows quicker. Nothing here is
 * communicated by colour or length alone, which is what keeps it readable for anyone who
 * cannot distinguish the tints — and what stops it becoming decoration.
 *
 * `percent` is a share for display, computed by the caller from figures the report already
 * produced. This component does no arithmetic beyond clamping.
 */
export function MeterBar({
  label,
  value,
  percent,
  tone = 'primary',
  rank,
  leading = false,
  className,
}: {
  label: string
  /** Pre-formatted figure shown at the end of the row. */
  value: string
  /** 0–100. Values outside that are clamped rather than allowed to overflow the track. */
  percent: number | null
  tone?: 'primary' | 'secondary' | 'neutral'
  /**
   * Position in an ordering the CALLER already has. Rendered as a numeral so a ranking is
   * legible without comparing bar lengths — this component never sorts anything.
   */
  rank?: number
  /** The top row of a ranking, drawn a step heavier so first place is obvious. */
  leading?: boolean
  className?: string
}) {
  const width = percent === null ? 0 : Math.min(100, Math.max(0, percent))

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-baseline gap-2">
          {rank !== undefined && (
            <span
              className={cn(
                'shrink-0 tabular-nums',
                leading ? 'text-sm font-semibold text-primary' : 'text-xs text-muted-foreground',
              )}
            >
              {rank}
            </span>
          )}
          <span className={cn('min-w-0 truncate', leading ? 'font-semibold' : 'font-medium')}>
            {label}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 tabular-nums',
            leading ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
        >
          {value}
        </span>
      </div>
      <div
        className={cn('w-full overflow-hidden rounded-full bg-muted', leading ? 'h-2.5' : 'h-2')}
        role="meter"
        aria-label={label}
        aria-valuenow={percent === null ? undefined : Math.round(width)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={percent === null ? 'Not available' : `${Math.round(width)}%`}
      >
        <div
          className={cn(
            // A short transition so a refreshed figure slides rather than jumping. Width
            // only: nothing changes position, and nothing animates on first paint.
            'h-full rounded-full transition-[width] duration-300 ease-out',
            tone === 'primary' && 'bg-[var(--chart-1)]',
            tone === 'secondary' && 'bg-[var(--chart-2)]',
            tone === 'neutral' && 'bg-[var(--chart-3)]',
          )}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}
