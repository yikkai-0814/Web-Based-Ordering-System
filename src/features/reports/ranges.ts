import type { TranslationKey } from '@/features/i18n/translations/en'
import { message, type Message } from '@/features/i18n/messages'
import { businessDateOf } from '@/features/pos/types'

/**
 * Date-range presets for the reports page.
 *
 * Every range is expressed as inclusive `YYYY-MM-DD` business dates, matching how orders
 * are filed — `businessDateOf` is reused rather than reimplemented so a report can never
 * disagree with the till about which day a sale belongs to.
 *
 * "Now" is always passed in. Nothing here reads the clock, which is what makes month and
 * week boundaries testable.
 */

export const RANGE_PRESETS = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'custom'] as const

export type RangePreset = (typeof RANGE_PRESETS)[number]

export const RANGE_LABEL_KEYS: Record<RangePreset, TranslationKey> = {
  today: 'reports.range.today',
  yesterday: 'reports.range.yesterday',
  thisWeek: 'reports.range.thisWeek',
  thisMonth: 'reports.range.thisMonth',
  custom: 'reports.range.custom',
}

export interface DateRange {
  /** Inclusive, `YYYY-MM-DD`. */
  from: string
  /** Inclusive, `YYYY-MM-DD`. */
  to: string
}

/**
 * A mis-typed year should not request every order ever written. 366 days covers a full
 * year including a leap year.
 */
export const MAX_RANGE_DAYS = 366

const DAY_MS = 24 * 60 * 60 * 1000

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * The Monday of the week containing `date`.
 *
 * `getDay()` is 0 for Sunday, so `(day + 6) % 7` gives days since Monday — 0 on Monday,
 * 6 on Sunday. The week starts Monday by decision, not by locale.
 */
function startOfWeek(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7))
}

/**
 * Resolves a preset against a given "today".
 *
 * "This Week" and "This Month" run to **today**, not to the end of the period — an owner
 * asking for this month means the month so far, and a range extending into the future
 * would only ever add empty days.
 */
export function rangeFor(preset: Exclude<RangePreset, 'custom'>, today: Date): DateRange {
  const to = businessDateOf(today)

  switch (preset) {
    case 'today':
      return { from: to, to }
    case 'yesterday': {
      const yesterday = businessDateOf(addDays(today, -1))
      return { from: yesterday, to: yesterday }
    }
    case 'thisWeek':
      return { from: businessDateOf(startOfWeek(today)), to }
    case 'thisMonth': {
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: businessDateOf(firstOfMonth), to }
    }
  }
}

export type RangeValidation = { ok: true; range: DateRange } | { ok: false; error: Message }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Parses a `YYYY-MM-DD` string, rejecting well-formed nonsense like 2026-02-31. */
function parseBusinessDate(value: string): Date | null {
  if (!DATE_PATTERN.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return null
  const date = new Date(year, month - 1, day)
  // A rolled-over date (31 February becoming 3 March) fails this check.
  if (businessDateOf(date) !== value) return null
  return date
}

export function validateCustomRange(from: string, to: string): RangeValidation {
  const start = parseBusinessDate(from)
  const end = parseBusinessDate(to)

  if (!start) return { ok: false, error: message('validation.startDate') }
  if (!end) return { ok: false, error: message('validation.endDate') }
  if (start.getTime() > end.getTime()) {
    return { ok: false, error: message('validation.startAfterEnd') }
  }

  const spanDays = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1
  if (spanDays > MAX_RANGE_DAYS) {
    return { ok: false, error: message('validation.rangeTooLong', { max: MAX_RANGE_DAYS }) }
  }

  return { ok: true, range: { from, to } }
}
