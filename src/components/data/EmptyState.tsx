import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * What a screen says when there is genuinely nothing to show.
 *
 * Worth having one of: an empty list that says nothing looks identical to one that failed to
 * load, and a café at 8am should be told "no orders yet today" rather than left staring at a
 * blank rectangle wondering whether the till is broken.
 *
 * Deliberately quiet — no illustration, no call to action unless the caller supplies one.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card/50 px-6 py-10 text-center',
        className,
      )}
    >
      {icon && <div className="text-muted-foreground/70">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && (
        <p className="max-w-prose text-sm text-balance text-muted-foreground">{description}</p>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}
