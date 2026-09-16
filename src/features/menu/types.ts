import type { Timestamp } from 'firebase/firestore'

import { ITEM_NAME_MAX, parseItemNames, type LocalizedName } from '@/features/menu/item-names'

/**
 * A grouping on the menu — Coffee, Pastries, Cold Drinks.
 *
 * `sortOrder` decides display order; ties break alphabetically by name so the list is
 * always deterministic even when an admin leaves several categories at 0.
 */
export interface Category {
  id: string
  name: string
  sortOrder: number
  active: boolean
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

/**
 * Something the café sells.
 *
 * `price` is **whole sen**, never a float — see src/lib/money.ts for why. The security
 * rules enforce the same invariant, so a bad price cannot be written even from devtools.
 */
export interface MenuItem {
  id: string
  /**
   * The English name, and the item's canonical one: what it sorts by, what the security
   * rules check, and what every other language falls back to. Unchanged since the first
   * version of this collection, which is why items written then are still valid documents.
   */
  name: string
  /**
   * The same name in each language the interface speaks, English included.
   *
   * Derived at parse time rather than stored whole: only the translations live in the
   * document, and English is filled in from `name`. Read it through
   * `getLocalizedMenuItemName`, never directly, so the fallback rule stays in one place.
   */
  names: LocalizedName
  description: string
  categoryId: string
  price: number
  sortOrder: number
  active: boolean
  /**
   * The shared customisation groups this item offers, in the order they should be asked.
   *
   * The association lives here rather than on the group because a group is shared: "Sugar
   * Level" is one definition attached to many drinks, and only the item can say where it
   * belongs in ITS list. Attaching and detaching is therefore a write to the item and never
   * to the shared definition, so two admins configuring two different drinks cannot contend.
   *
   * Absent on every item written before groups were reusable, which is why it parses to an
   * empty array rather than being required: those items resolve their groups through the
   * legacy `modifierGroups.itemId` instead. See `groupsForItem`.
   */
  modifierGroupIds: string[]
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

/**
 * What the café pays for an item, in whole sen.
 *
 * Stored in its own `menuItemCosts` collection, keyed by the menu item's id, and readable
 * only by admins. Firestore permissions are per-document, so a cost field on the menu item
 * itself would be readable by every staff account that reads the menu. See firestore.rules.
 */
export interface ItemCost {
  itemId: string
  cost: number
  updatedAt: Timestamp | null
}

export function parseItemCost(itemId: string, data: Record<string, unknown>): ItemCost | null {
  const { cost, updatedAt } = data
  if (typeof cost !== 'number' || !Number.isInteger(cost) || cost < 0) return null
  return {
    itemId,
    cost,
    updatedAt: (updatedAt as Timestamp | undefined) ?? null,
  }
}

export const CATEGORY_NAME_MAX = 60
/** Defined in item-names.ts, beside the rest of what a name is. Re-exported for its callers. */
export { ITEM_NAME_MAX }
export const ITEM_DESCRIPTION_MAX = 300

/**
 * Firestore documents are untyped on the wire, so every document is validated before the
 * app trusts it — the same approach as `parseUserProfile` in src/features/auth/types.ts.
 * A malformed document returns null and is skipped by the hooks rather than rendering as
 * "undefined" or, worse, a NaN price.
 */
export function parseCategory(id: string, data: Record<string, unknown>): Category | null {
  const { name, sortOrder, active, createdAt, updatedAt } = data

  if (typeof name !== 'string' || name.trim() === '') return null
  if (typeof active !== 'boolean') return null

  return {
    id,
    name,
    sortOrder: typeof sortOrder === 'number' && Number.isFinite(sortOrder) ? sortOrder : 0,
    active,
    createdAt: (createdAt as Timestamp | undefined) ?? null,
    updatedAt: (updatedAt as Timestamp | undefined) ?? null,
  }
}

export function parseMenuItem(id: string, data: Record<string, unknown>): MenuItem | null {
  const { name, description, categoryId, price, sortOrder, active, createdAt, updatedAt } = data
  const { modifierGroupIds, names } = data

  if (typeof name !== 'string' || name.trim() === '') return null
  if (typeof categoryId !== 'string' || categoryId === '') return null
  if (typeof active !== 'boolean') return null
  // A non-integer price means the document was written by something that bypassed both
  // the form and the rules. Refuse it rather than display a rounded lie.
  if (typeof price !== 'number' || !Number.isInteger(price) || price < 0) return null

  return {
    id,
    name,
    // Absent on every item written before this feature, and on every item an admin has not
    // given a translation to. Both resolve to English, which is what the document already
    // says — so nothing has to be migrated for an old item to keep working.
    names: parseItemNames(name, names),
    description: typeof description === 'string' ? description : '',
    categoryId,
    price,
    sortOrder: typeof sortOrder === 'number' && Number.isFinite(sortOrder) ? sortOrder : 0,
    active,
    // Anything that is not a usable id is dropped rather than carried: it could only ever
    // fail to resolve, and a silently shorter list is the honest answer.
    modifierGroupIds: Array.isArray(modifierGroupIds)
      ? modifierGroupIds.filter(
          (value): value is string => typeof value === 'string' && value !== '',
        )
      : [],
    createdAt: (createdAt as Timestamp | undefined) ?? null,
    updatedAt: (updatedAt as Timestamp | undefined) ?? null,
  }
}

/** Shared ordering: explicit sortOrder first, then name, so lists never jitter. */
export function bySortOrderThenName<T extends { sortOrder: number; name: string }>(
  a: T,
  b: T,
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  return a.name.localeCompare(b.name)
}
