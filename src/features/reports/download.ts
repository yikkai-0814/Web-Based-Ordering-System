/**
 * Triggering a browser download.
 *
 * Kept apart from csv.ts so that the CSV string building stays pure and can be unit-tested
 * in a Node environment without a DOM. This half is not unit-tested — it is three lines of
 * browser plumbing whose only meaningful failure mode is visible immediately.
 */
export function downloadCsv(filename: string, content: string): void {
  // The leading BOM is what makes Excel read UTF-8 correctly; without it, any accented or
  // non-Latin character in an item name arrives mangled.
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
