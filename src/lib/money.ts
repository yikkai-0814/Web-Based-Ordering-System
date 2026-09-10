/**
 * Money handling for the whole system.
 *
 * **Amounts are integers in the currency's minor unit (sen), never floats.** RM 12.50 is
 * stored and passed around as `1250`. Floating-point money is the classic point-of-sale
 * defect: the errors are invisible on one item and compound across a cart until the
 * printed total disagrees with the cash drawer. Keeping everything in whole sen means
 * addition and multiplication are exact, and rounding happens once, at the point of
 * display.
 *
 * This module owns the only two conversions that exist. Nothing else in the codebase
 * should divide or multiply a price by 100.
 */

/** Change these two lines to move the system to another currency. */
export const CURRENCY_CODE = 'MYR'
export const CURRENCY_PREFIX = 'RM'

/** Minor units per major unit — 100 sen to the ringgit. */
const MINOR_UNITS = 100

export type ParsedPrice = { ok: true; sen: number } | { ok: false; error: string }

/**
 * Formats an integer sen amount for display, e.g. `1250` -> `"RM 12.50"`.
 *
 * Deliberately hand-rolled rather than `Intl.NumberFormat`: ICU renders MYR with a
 * non-breaking space in some runtimes and a plain space in others, which would make the
 * output differ between Node (tests) and the browser (app). A fixed format is worth more
 * here than locale flexibility.
 */
export function formatMoney(sen: number): string {
  if (!Number.isInteger(sen)) {
    throw new Error(`formatMoney expects whole sen, received ${sen}`)
  }

  const negative = sen < 0
  const absolute = Math.abs(sen)
  const major = Math.floor(absolute / MINOR_UNITS)
  const minor = absolute % MINOR_UNITS

  // en-US grouping gives the thousands separators used locally (1,234.50).
  const grouped = major.toLocaleString('en-US')
  const decimals = String(minor).padStart(2, '0')

  return `${negative ? '-' : ''}${CURRENCY_PREFIX} ${grouped}.${decimals}`
}

/**
 * Parses what a person typed into a price field into whole sen.
 *
 * Returns a discriminated result rather than throwing or returning `NaN`, so the form can
 * show a specific message. Tolerant of a currency prefix, thousands separators and
 * surrounding whitespace, which means it also accepts its own `formatMoney` output —
 * useful when a value is pasted back in.
 */
export function parsePriceInput(input: string): ParsedPrice {
  const trimmed = input.trim()

  if (trimmed === '') {
    return { ok: false, error: 'Enter a price.' }
  }

  if (trimmed.includes('-')) {
    return { ok: false, error: 'A price cannot be negative.' }
  }

  // Strip the currency prefix, grouping commas and any whitespace (including the
  // non-breaking kind that pasted values often carry).
  const cleaned = trimmed.replace(/[\s ,]/g, '').replace(new RegExp(`^${CURRENCY_PREFIX}`, 'i'), '')

  if (cleaned === '') {
    return { ok: false, error: 'Enter a price.' }
  }

  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return { ok: false, error: 'Enter a number, for example 12.50.' }
  }

  const [major = '', minor = ''] = cleaned.split('.')

  if (minor.length > 2) {
    return { ok: false, error: 'Use at most 2 decimal places.' }
  }

  // String maths, not `parseFloat(x) * 100` — the multiply is exactly what loses cents.
  const sen = Number(major) * MINOR_UNITS + Number(minor.padEnd(2, '0') || '0')

  if (!Number.isSafeInteger(sen)) {
    return { ok: false, error: 'That price is too large.' }
  }

  return { ok: true, sen }
}

/** The value to put in a price `<input>` when editing an existing amount: `1250` -> `"12.50"`. */
export function toPriceInputValue(sen: number): string {
  const major = Math.floor(Math.abs(sen) / MINOR_UNITS)
  const minor = Math.abs(sen) % MINOR_UNITS
  return `${major}.${String(minor).padStart(2, '0')}`
}
