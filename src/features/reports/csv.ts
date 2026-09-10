/**
 * CSV building and download.
 *
 * CSV rather than xlsx or PDF on purpose: it needs no dependency, and it opens in Excel.
 * A real `.xlsx` writer or a PDF renderer would each be a runtime library for a format
 * this already covers.
 */

/**
 * Quotes a field only when it needs it, per RFC 4180: a field containing a comma, a double
 * quote, or a line break is wrapped in quotes, and embedded quotes are doubled.
 *
 * This matters more than it looks — an item called `Ali's "Special", large` or a void
 * reason containing a newline would otherwise silently shift every later column.
 */
export function escapeCsvField(value: string | number): string {
  const text = String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function toCsv(rows: readonly (readonly (string | number)[])[]): string {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')
}
