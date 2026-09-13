// @vitest-environment jsdom
/**
 * The business-date calendar.
 *
 * It replaced an `<input type="date">`, whose popup the browser drew and the app could not
 * style. What matters in a replacement is that it is still only a way of typing a date: the
 * value it emits is the same `YYYY-MM-DD` string, produced by the same `businessDateOf`, and
 * it still refuses a day the field's `max` refused.
 *
 * The rest is what the refinement was for — that the selected day, and today, are each
 * unmistakable.
 *
 * The clock is deliberately NOT faked here. Faking it makes user-event wait on timers
 * nothing advances, and it is unnecessary: every assertion below is either about a fixed
 * month whose `max` is fixed with it, or about the real today, which the test derives the
 * same way the component does.
 */
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DatePickerCalendar } from '@/features/pos/DatePickerCalendar'
import { businessDateOf } from '@/features/pos/types'

import { renderComponent } from './render'

/** Derived exactly as the component derives it, so the two cannot disagree at midnight. */
const TODAY = businessDateOf(new Date())

/** Another day in the same month as today, so both are always on screen together. */
const OTHER_DAY_THIS_MONTH = `${TODAY.slice(0, 8)}${TODAY.endsWith('01') ? '02' : '01'}`

/** A fixed month, self-consistent: its `max` is inside it, so the real date is irrelevant. */
const FIXED = '2026-09-14' // a Monday
const FIXED_MAX = '2026-09-14'

function setup(value: string, max: string) {
  const onSelect = vi.fn()
  const rendered = renderComponent(
    <DatePickerCalendar value={value} max={max} onSelect={onSelect} />,
  )
  return { ...rendered, onSelect }
}

const day = (iso: string) => {
  const found = screen
    .getAllByTestId('calendar-day')
    .find((node) => node.getAttribute('data-date') === iso)
  if (!found) throw new Error(`no day ${iso}`)
  return found
}

describe('what the grid shows', () => {
  it('opens on the month of the selected day', () => {
    setup('2026-07-04', '2026-07-31')
    expect(screen.getByTestId('calendar-month').textContent).toBe('July 2026')
  })

  it('always draws six whole weeks, so the popover never changes height', () => {
    setup(FIXED, FIXED_MAX)
    expect(screen.getAllByTestId('calendar-day')).toHaveLength(42)
  })

  it('pads with the neighbouring months, marked as outside the one being read', () => {
    setup(FIXED, FIXED_MAX)
    // 1 September 2026 is a Tuesday, so the grid opens with one day of August.
    expect(day('2026-08-31').getAttribute('data-outside')).toBe('true')
    expect(day('2026-09-01').getAttribute('data-outside')).toBe('false')
  })

  it('names every weekday column', () => {
    setup(FIXED, FIXED_MAX)
    expect(screen.getAllByRole('columnheader')).toHaveLength(7)
  })
})

describe('the selected day is unmistakable', () => {
  it('marks exactly one square as selected', () => {
    setup('2026-09-09', '2026-09-30')
    const selected = screen
      .getAllByTestId('calendar-day')
      .filter((node) => node.getAttribute('data-selected') === 'true')

    expect(selected).toHaveLength(1)
    expect(selected[0]?.getAttribute('data-date')).toBe('2026-09-09')
    expect(selected[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('fills the selected square rather than merely outlining it', () => {
    setup('2026-09-09', '2026-09-30')
    expect(day('2026-09-09').className).toContain('bg-primary')
  })
})

describe('today is marked, without competing with the selection', () => {
  it('marks today when another day is selected', () => {
    setup(OTHER_DAY_THIS_MONTH, TODAY)
    expect(day(TODAY).getAttribute('data-today')).toBe('true')
    expect(day(TODAY).getAttribute('aria-current')).toBe('date')
    // Marked, but not the filled square: only one answers "which day am I looking at".
    expect(day(TODAY).getAttribute('data-selected')).toBe('false')
  })

  it('marks no other square as today', () => {
    setup(OTHER_DAY_THIS_MONTH, TODAY)
    const marked = screen
      .getAllByTestId('calendar-day')
      .filter((node) => node.getAttribute('data-today') === 'true')
    expect(marked).toHaveLength(1)
  })

  it('does not draw two marks when today IS the selection', () => {
    setup(TODAY, TODAY)
    const square = day(TODAY)
    expect(square.getAttribute('data-selected')).toBe('true')
    expect(square.getAttribute('data-today')).toBe('true')
    expect(square.className).toContain('bg-primary')
  })
})

describe('it refuses the days the field refused', () => {
  it('disables anything after the maximum', () => {
    setup(FIXED, FIXED_MAX)
    expect((day('2026-09-15') as HTMLButtonElement).disabled).toBe(true)
    expect((day('2026-09-30') as HTMLButtonElement).disabled).toBe(true)
  })

  it('leaves every earlier day selectable', () => {
    setup(FIXED, FIXED_MAX)
    expect((day('2026-09-13') as HTMLButtonElement).disabled).toBe(false)
    expect((day('2026-09-01') as HTMLButtonElement).disabled).toBe(false)
  })

  it('will not step past the last month there is anything to show in', () => {
    setup(FIXED, FIXED_MAX)
    expect((screen.getByTestId('calendar-next-month') as HTMLButtonElement).disabled).toBe(true)
  })

  it('does step forward when there is a later month to reach', () => {
    setup('2026-07-04', '2026-09-30')
    expect((screen.getByTestId('calendar-next-month') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('choosing a day', () => {
  it('emits the date as the same string the rest of the system uses', async () => {
    const { user, onSelect } = setup(FIXED, FIXED_MAX)
    await user.click(day('2026-09-03'))
    expect(onSelect).toHaveBeenCalledWith('2026-09-03')
  })

  it('emits nothing for a day that is out of range', async () => {
    const { user, onSelect } = setup(FIXED, FIXED_MAX)
    await user.click(day('2026-09-20'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('reaches an earlier month and emits from there', async () => {
    const { user, onSelect } = setup(FIXED, FIXED_MAX)

    await user.click(screen.getByTestId('calendar-previous-month'))
    expect(screen.getByTestId('calendar-month').textContent).toBe('August 2026')

    await user.click(day('2026-08-12'))
    expect(onSelect).toHaveBeenCalledWith('2026-08-12')
  })

  it('crosses a year boundary without confusing the month heading', async () => {
    const { user } = setup('2027-01-15', '2027-01-31')
    expect(screen.getByTestId('calendar-month').textContent).toBe('January 2027')

    await user.click(screen.getByTestId('calendar-previous-month'))
    expect(screen.getByTestId('calendar-month').textContent).toBe('December 2026')
  })
})
