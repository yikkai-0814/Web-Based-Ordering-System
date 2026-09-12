import type { ReactNode } from 'react'

import { SectionHeader } from '@/components/data/SectionHeader'
import { cn } from '@/lib/utils'

/**
 * A band of a page, at one of three weights.
 *
 * The point is that they are *different*. Before this, every section on the Dashboard and
 * Reports was the same white rounded rectangle with the same border and the same shadow, so
 * the financial figures an admin opens the page for looked exactly like the supporting
 * breakdown underneath them, and the reader had to sort it out by reading.
 *
 *   * `accent` — the reason the page exists. Tinted, bordered in the brand, slightly more
 *     padding. Used once per page, or it stops meaning anything.
 *   * `raised` — a real card: white, bordered, a hairline shadow.
 *   * `plain` — no surface at all. A heading and its content sitting directly on the page,
 *     for supporting material that does not need to be boxed to be understood.
 *
 * Three levels is the whole vocabulary. Anything needing a fourth is probably two sections.
 */
export type PanelTone = 'accent' | 'raised' | 'plain'

const TONE: Record<PanelTone, string> = {
  accent: 'rounded-xl border border-primary/25 bg-primary/[0.03] p-4 shadow-xs sm:p-5',
  raised: 'rounded-xl border bg-card p-4 shadow-xs',
  plain: '',
}

export function Panel({
  title,
  description,
  action,
  tone = 'raised',
  as,
  children,
  className,
  ...rest
}: {
  title?: string
  description?: string
  action?: ReactNode
  tone?: PanelTone
  /** Heading level for the title, when this panel nests inside another section. */
  as?: 'h2' | 'h3'
  children: ReactNode
  className?: string
  'aria-label'?: string
  'data-testid'?: string
}) {
  return (
    <section className={cn('space-y-3', TONE[tone], className)} {...rest}>
      {title && <SectionHeader title={title} description={description} action={action} as={as} />}
      {children}
    </section>
  )
}
