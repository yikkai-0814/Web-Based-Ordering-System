/**
 * Deciding when the cost journal needs an opening entry.
 *
 * Pure and free of Firestore imports so the rule can be unit-tested; `menu-api.ts` supplies
 * the facts it needs.
 *
 * **Why this exists.** `menuItemCosts` shipped in Phase 2; the `menuItemCostHistory`
 * journal arrived in Phase 3. A cost recorded in between — or written outside the app —
 * therefore has a current value but no history. Reports fall back to that current value for
 * such an item, which is correct while it stays historyless.
 *
 * The moment someone edits that cost, a single history entry appears dated *now*. From then
 * on the item has history, so the fallback no longer applies, and every sale made before the
 * edit silently flips from "cost known" to "cost unknown" — the previous value has nowhere
 * to live. Writing an opening entry for the outgoing value, dated when that value was
 * actually recorded, is what stops the edit destroying what was already known.
 */

export interface OpeningEntry {
  cost: number
  /** When the outgoing cost was recorded — never fabricated, never "now". */
  effectiveFrom: Date
}

/**
 * The opening entry a cost change needs, or null when none is warranted.
 *
 * Returns null when:
 *   * there is no previous cost to preserve;
 *   * the item already has history, so the journal is already authoritative;
 *   * the previous cost cannot be dated, in which case inventing a timestamp would be
 *     worse than leaving the gap — a fabricated `effectiveFrom` would claim knowledge the
 *     system never had.
 */
export function openingEntryFrom(
  previousCost: number | null,
  hasExistingHistory: boolean,
  previousRecordedAt: Date | null,
): OpeningEntry | null {
  if (previousCost === null) return null
  if (hasExistingHistory) return null
  if (previousRecordedAt === null) return null
  return { cost: previousCost, effectiveFrom: previousRecordedAt }
}
