import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { businessDateOf, shiftBusinessDate } from '@/features/pos/types'

/**
 * Picks which business day the workspace is showing.
 *
 * The date is not decoration — it **is** the query. Everything on the Orders list and the
 * queue is read for this one day, which is what keeps a café that has been trading for two
 * years from loading two years of sales to show this morning's.
 *
 * Stepping forward stops at today. There is nothing to see beyond it: an order is filed
 * under the day it was rung up, so a future date can only ever be empty, and offering the
 * step would suggest otherwise.
 */
export function BusinessDateBar({
  businessDate,
  onChange,
  children,
}: {
  businessDate: string
  onChange: (next: string) => void
  /** Anything the page wants on the same row — a count, a filter, a search box. */
  children?: ReactNode
}) {
  const today = businessDateOf(new Date())
  const isToday = businessDate === today

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="business-date">Business date</Label>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Previous day"
            data-testid="previous-day"
            onClick={() => onChange(shiftBusinessDate(businessDate, -1))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Input
            id="business-date"
            type="date"
            className="h-9 w-40"
            data-testid="business-date"
            max={today}
            value={businessDate}
            onChange={(event) => {
              // An empty value means the field was cleared mid-edit; keeping the current day
              // is better than querying for orders filed under "".
              if (event.target.value !== '') onChange(event.target.value)
            }}
          />
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Next day"
            data-testid="next-day"
            disabled={isToday}
            onClick={() => onChange(shiftBusinessDate(businessDate, 1))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button
            variant={isToday ? 'secondary' : 'outline'}
            disabled={isToday}
            data-testid="today"
            onClick={() => onChange(today)}
          >
            Today
          </Button>
        </div>
      </div>

      {children}
    </div>
  )
}
