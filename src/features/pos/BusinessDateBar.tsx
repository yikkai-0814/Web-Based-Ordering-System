import { useState, type ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DatePickerCalendar } from '@/features/pos/DatePickerCalendar'
import { businessDateOf, shiftBusinessDate } from '@/features/pos/types'
import { cn } from '@/lib/utils'

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
 *
 * The day itself is chosen from `DatePickerCalendar` rather than an `<input type="date">`.
 * That is a presentation change and nothing more — the same `YYYY-MM-DD` string reaches
 * `onChange` either way — made because the native field's calendar is drawn by the browser
 * and cannot be given this application's typography, spacing or selected-day treatment.
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
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-4">
      <div className="grid gap-1.5">
        <Label htmlFor="business-date">Business date</Label>
        {/* One bordered group rather than four loose controls: they answer a single question,
            and on a narrow screen a row of separated buttons wraps into nonsense. */}
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-xs">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous day"
            data-testid="previous-day"
            onClick={() => onChange(shiftBusinessDate(businessDate, -1))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>

          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                id="business-date"
                variant="ghost"
                data-testid="business-date"
                data-value={businessDate}
                aria-label={`Business date: ${businessDate}. Choose another`}
                className="min-w-40 justify-start gap-2 font-medium tabular-nums"
              >
                <CalendarDays aria-hidden="true" className="text-muted-foreground" />
                {businessDate}
              </Button>
            </PopoverTrigger>
            <PopoverContent>
              <DatePickerCalendar
                value={businessDate}
                max={today}
                onSelect={(next) => {
                  onChange(next)
                  setOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Next day"
            data-testid="next-day"
            disabled={isToday}
            onClick={() => onChange(shiftBusinessDate(businessDate, 1))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>

          <Button
            variant={isToday ? 'secondary' : 'ghost'}
            size="sm"
            disabled={isToday}
            data-testid="today"
            // Reads as the current state when it is, rather than as an action that does
            // nothing.
            className={cn('ml-0.5', isToday && 'disabled:opacity-100')}
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
