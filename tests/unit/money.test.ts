import { say } from '../say'
import { describe, expect, it } from 'vitest'

import { formatMoney, parsePriceInput, toPriceInputValue } from '@/lib/money'

/** Convenience: assert a successful parse and return the sen value. */
function sen(input: string): number {
  const result = parsePriceInput(input)
  if (!result.ok) throw new Error(`expected "${input}" to parse, got: ${result.error}`)
  return result.sen
}

/** Convenience: assert a failed parse and return the message. */
/** The refusal, rendered in English — the rule is the key, the sentence is what it says. */
function failure(input: string): string {
  const result = parsePriceInput(input)
  if (result.ok) throw new Error(`expected "${input}" to fail, got ${result.sen}`)
  return say(result.error)
}

describe('parsePriceInput', () => {
  it('parses two-decimal prices to whole sen', () => {
    expect(sen('12.50')).toBe(1250)
    expect(sen('0.05')).toBe(5)
    expect(sen('99.99')).toBe(9999)
  })

  it('treats a single decimal place as tenths, not hundredths', () => {
    expect(sen('12.5')).toBe(1250)
    expect(sen('0.1')).toBe(10)
  })

  it('parses whole numbers', () => {
    expect(sen('12')).toBe(1200)
    expect(sen('0')).toBe(0)
  })

  it('tolerates surrounding whitespace, a currency prefix and grouping commas', () => {
    expect(sen('  12.50  ')).toBe(1250)
    expect(sen('RM 12.50')).toBe(1250)
    expect(sen('rm12.50')).toBe(1250)
    expect(sen('1,234.50')).toBe(123450)
  })

  it('rejects empty input', () => {
    expect(failure('')).toMatch(/enter a price/i)
    expect(failure('   ')).toMatch(/enter a price/i)
  })

  it('rejects non-numeric input rather than returning NaN', () => {
    expect(failure('abc')).toMatch(/enter a number/i)
    expect(failure('12abc')).toMatch(/enter a number/i)
    expect(failure('.')).toMatch(/enter a number/i)
  })

  it('rejects negative prices', () => {
    expect(failure('-1')).toMatch(/negative/i)
    expect(failure('-0.01')).toMatch(/negative/i)
  })

  it('rejects more than two decimal places instead of silently rounding', () => {
    // Silently rounding here is how a menu ends up a cent off the printed price.
    expect(failure('12.505')).toMatch(/2 decimal places/i)
    expect(failure('0.001')).toMatch(/2 decimal places/i)
  })

  it('rejects amounts beyond safe integer precision', () => {
    expect(failure('999999999999999999')).toMatch(/too large/i)
  })
})

describe('formatMoney', () => {
  it('formats whole sen with two decimals', () => {
    expect(formatMoney(1250)).toBe('RM 12.50')
    expect(formatMoney(0)).toBe('RM 0.00')
    expect(formatMoney(5)).toBe('RM 0.05')
    expect(formatMoney(100)).toBe('RM 1.00')
  })

  it('groups thousands', () => {
    expect(formatMoney(123450)).toBe('RM 1,234.50')
    expect(formatMoney(100000000)).toBe('RM 1,000,000.00')
  })

  it('handles negative amounts, which refunds will need later', () => {
    expect(formatMoney(-1250)).toBe('-RM 12.50')
  })

  it('refuses a fractional sen value rather than rounding it away', () => {
    expect(() => formatMoney(12.5)).toThrow(/whole sen/i)
  })
})

describe('round trip', () => {
  it('parsePriceInput(formatMoney(n)) preserves n', () => {
    const values = [0, 1, 5, 99, 100, 1250, 9999, 123450, 100000000]
    for (const value of values) {
      expect(sen(formatMoney(value))).toBe(value)
    }
  })

  it('parsePriceInput(toPriceInputValue(n)) preserves n', () => {
    const values = [0, 1, 5, 99, 100, 1250, 9999, 123450]
    for (const value of values) {
      expect(sen(toPriceInputValue(value))).toBe(value)
    }
  })

  it('never loses a cent on values that break naive float maths', () => {
    // parseFloat('1.15') * 100 is 114.99999999999999 — the bug this module exists to avoid.
    expect(sen('1.15')).toBe(115)
    expect(sen('2.35')).toBe(235)
    expect(sen('8.20')).toBe(820)
    expect(failure('1.005')).toMatch(/2 decimal places/i)
  })
})

describe('toPriceInputValue', () => {
  it('renders an editable value without the currency prefix', () => {
    expect(toPriceInputValue(1250)).toBe('12.50')
    expect(toPriceInputValue(0)).toBe('0.00')
    expect(toPriceInputValue(5)).toBe('0.05')
  })
})
