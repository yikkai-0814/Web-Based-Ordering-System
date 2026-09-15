import type { Timestamp } from 'firebase/firestore'

/**
 * What the café pays for one modifier option, and how that option's cost is addressed.
 *
 * **Why this is not a field on the option.** An option lives inside its group document, and
 * `modifierGroups` is staff-readable — the till cannot ask "extra egg?" without reading it.
 * Firestore grants or denies a whole document, so a `cost` beside `priceAdjustment` would be
 * a cost every staff account could read. That is the same reasoning that put `ItemCost` in
 * `menuItemCosts` rather than on `menuItems`, and it applies here unchanged. A second
 * reason reinforces it: the rules cannot iterate a list, so a cost held inside the options
 * array could never be validated at the security layer at all.
 *
 * **Why the key is (groupId, optionId) and never the menu item.** A group is a shared
 * definition: "Add-On" is attached to every rice dish on the menu. A fried egg costs the
 * café the same whichever dish it joins, so the cost belongs to the option itself. Keying by
 * item would store the same figure once per dish, and those copies could disagree.
 *
 * Option ids are unique only WITHIN their group, so the two parts are combined into one
 * document id rather than the option id being used alone.
 *
 * This module is deliberately dependency-free: the write path (menu-api), the read path
 * (reports-api) and the pure resolution (reports/aggregate) all have to agree on this key,
 * and none of them should have to import the others to do so.
 */

/**
 * Separates the two halves of a cost document's id.
 *
 * Firestore auto-ids are alphanumeric and option ids are `opt-` followed by a base-36
 * suffix, so neither half can contain this sequence and no two different options can
 * collide on one key.
 */
export const MODIFIER_COST_KEY_SEPARATOR = '__'

/** The document id in `modifierOptionCosts`, and the lookup key used when reporting. */
export function modifierCostKey(groupId: string, optionId: string): string {
  return `${groupId}${MODIFIER_COST_KEY_SEPARATOR}${optionId}`
}

/**
 * What the café pays for one option, in whole sen.
 *
 * Stored in `modifierOptionCosts/{groupId}__{optionId}`, admin-only at the rules layer.
 * The two halves are stored as fields as well as encoded in the id: the id is how a single
 * cost is addressed, the fields are what lets every cost for one group be fetched with a
 * single `where('groupId', '==', …)` query when that group is edited.
 */
export interface ModifierOptionCost {
  groupId: string
  optionId: string
  cost: number
  updatedAt: Timestamp | null
}

/**
 * Validates a cost document before the app trusts it, exactly as `parseItemCost` does.
 *
 * A malformed document is skipped rather than defaulted to zero: zero claims the option is
 * free to provide, which is a statement, and inventing it would quietly overstate profit.
 */
export function parseModifierOptionCost(
  id: string,
  data: Record<string, unknown>,
): ModifierOptionCost | null {
  const { groupId, optionId, cost, updatedAt } = data

  if (typeof groupId !== 'string' || groupId === '') return null
  if (typeof optionId !== 'string' || optionId === '') return null
  // The fields must agree with the id they are stored under. A document that disagrees
  // could be resolved by one route and not the other, which is worse than being skipped.
  if (modifierCostKey(groupId, optionId) !== id) return null
  if (typeof cost !== 'number' || !Number.isInteger(cost) || cost < 0) return null

  return {
    groupId,
    optionId,
    cost,
    updatedAt: (updatedAt as Timestamp | undefined) ?? null,
  }
}
