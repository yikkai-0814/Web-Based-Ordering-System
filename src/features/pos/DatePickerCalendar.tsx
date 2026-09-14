import type { TranslationKey } from '@/features/i18n/translations/en'
import { useTranslation } from '@/features/i18n/useTranslation'
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { businessDateOf } from '@/features/pos/types'
import { cn } from '@/lib/utils'

/**
 * A month grid for choosing a business date.
 *
 * **Presentation only.** It emits the same `YYYY-MM-DD` string the field it replaces emitted,
 * through the same callback, and every date this system reasons about still comes from
 * `businessDateOf` and `shiftBusinessDate`. Nothing here decides what a business date means,
 * what "today" is, or which day an order belongs to.
 *
 * It exists because the previous control was `<input type="date">`, whose calendar is drawn
 * by the browser: it cannot be styled, it looks different on every machine, and on Windows
 * it shares none of this application's typography or spacing. Replacing it is the only way
 * to make the selected day obvious in the app's own visual language.
 *
 * The arithmetic below builds a grid of squares and does nothing else. It is deliberately
 * written on local date parts, exactly as `businessDateOf` is, so a month boundary lands on
 * the same day the rest of the system would file an order under.
 */

/**
 * Monday-first, matching the grid below. Keys rather than words: the column headings are
 * predefined interface text like everything else, and a Malay or Chinese till should not
 * have seven English abbreviations across the top of its calendar.
 */
const WEEKDAY_KEYS = [
  'date.monday',
  'date.tuesday',
  'date.wednesday',
  'date.thursday',
  'date.friday',
  'date.saturday',
  'date.sunday',
] as const satisfies readonly TranslationKey[]

/** `getMonth()` counts from 0; these keys count from 1, the way a person names a month. */
const MONTH_KEYS = [
  'date.month.1',
  'date.month.2',
  'date.month.3',
  'date.month.4',
  'date.month.5',
  'date.month.6',
  'date.month.7',
  'date.month.8',
  'date.month.9',
  'date.month.10',
  'date.month.11',
  'date.month.12',
] as const satisfies readonly TranslationKey[]

/** `YYYY-MM-DD` to a local Date at midnight. The inverse of `businessDateOf`. */
function dateOf(businessDate: string): Date {
  const [year, month, day] = businessDate.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

/**
 * Every square in the grid: the days of `month`, padded to whole weeks with the days either
 * side of it, so the columns line up under their weekday headings.
 *
 * Monday-first, which is how a trading week is read here.
 */
function gridFor(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  // getDay() is Sunday-first; shift so Monday is 0.
  const leading = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - leading)

  const squares: Date[] = []
  // Six weeks always: a grid that changed height as the month changed would make the
  // popover jump under the cursor.
  for (let index = 0; index < 42; index += 1) {
    squares.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
  }
  return squares
}

export function DatePickerCalendar({
  /** The chosen day, `YYYY-MM-DD`. */
  value,
  /** The latest selectable day, `YYYY-MM-DD`. Days after it are shown but not choosable. */
  max,
  onSelect,
}: {
  value: string
  max: string
  onSelect: (next: string) => void
}) {
  const { t } = useTranslation()
  const selected = useMemo(() => dateOf(value), [value])
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1))

  const today = businessDateOf(new Date())
  const squares = useMemo(() => gridFor(month), [month])

  function step(months: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + months, 1))
  }

  // Stepping past the last selectable month has nothing to show, exactly as the day stepper
  // stops at today.
  const maxMonth = dateOf(max)
  const atLastMonth =
    month.getFullYear() === maxMonth.getFullYear() && month.getMonth() === maxMonth.getMonth()

  return (
    <div className="w-[17.5rem]" data-testid="calendar">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('date.previousMonth')}
          data-testid="calendar-previous-month"
          onClick={() => step(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        {/* The heading is the anchor for the whole grid, so it is the only bold thing in it. */}
        <span
          className="text-sm font-semibold tabular-nums"
          aria-live="polite"
          data-testid="calendar-month"
        >
          {t(MONTH_KEYS[month.getMonth()] ?? 'date.month.1')} {month.getFullYear()}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('date.nextMonth')}
          data-testid="calendar-next-month"
          disabled={atLastMonth}
          onClick={() => step(1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      <div
        className="grid grid-cols-7 gap-0.5"
        role="grid"
        aria-label={t('date.chooseBusinessDate')}
      >
        {WEEKDAY_KEYS.map((weekdayKey) => (
          <span
            key={weekdayKey}
            role="columnheader"
            aria-label={t(weekdayKey)}
            className="pb-1 text-center text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase"
          >
            {t(weekdayKey)}
          </span>
        ))}

        {squares.map((square) => {
          const iso = businessDateOf(square)
          const isSelected = iso === value
          const isToday = iso === today
          const outside = square.getMonth() !== month.getMonth()
          const disabled = iso > max

          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              aria-label={iso}
              aria-selected={isSelected}
              aria-current={isToday ? 'date' : undefined}
              disabled={disabled}
              data-testid="calendar-day"
              data-date={iso}
              data-selected={isSelected ? 'true' : 'false'}
              data-today={isToday ? 'true' : 'false'}
              data-outside={outside ? 'true' : 'false'}
              onClick={() => onSelect(iso)}
              className={cn(
                'relative flex size-9 items-center justify-center rounded-md text-sm tabular-nums transition-colors',
                'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                'disabled:pointer-events-none disabled:opacity-30',
                // Days spilling in from the neighbouring months are shown so the weeks line
                // up, but they are not the month being read.
                outside ? 'text-muted-foreground/50' : 'text-foreground',
                !isSelected && 'hover:bg-muted',
                // The selected day is a solid block of brand colour: at a glance across a
                // counter, a mere ring is not enough to find it.
                isSelected && 'bg-primary font-semibold text-primary-foreground hover:bg-primary',
                // Today, when it is not the selection, is marked with a dot rather than a
                // second fill — two filled squares would compete for the same answer.
                isToday && !isSelected && 'font-semibold text-foreground',
              )}
            >
              {square.getDate()}
              {isToday && !isSelected && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-1 size-1 rounded-full bg-primary"
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
