import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The heading that opens a band of a page.
 *
 * One definition rather than the same three classes repeated at every section across the
 * Dashboard and Reports — those had already drifted apart by a size and a weight.
 *
 * `<h2>` by default because these sit under the page's own `<h1>`; a caller nesting deeper
 * passes `as="h3"` rather than styling a div to look like a heading, so the document outline
 * stays honest for anyone navigating by headings.
 */
export function SectionHeader({
  title,
  description,
  action,
  as: Heading = 'h2',
  className,
}: {
  title: string
  description?: string
  /** A control belonging to the section — a refresh button, a filter. */
  action?: ReactNode
  as?: 'h2' | 'h3'
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1', className)}>
      <div className="min-w-0 space-y-0.5">
        <Heading className="text-sm font-semibold tracking-wide uppercase">{title}</Heading>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
