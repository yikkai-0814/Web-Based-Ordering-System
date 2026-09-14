import type { ModifierGroupInput } from '@/features/menu/menu-api'

/**
 * Customisation being configured for a menu item that does not exist yet.
 *
 * Kept in its own module so NewItemCustomisation.tsx exports a component and nothing else,
 * which is what React Fast Refresh needs — the same split as auth-context.ts.
 */
export interface DraftCustomisation {
  /** Existing shared definitions attached to this item, in the order shown. */
  attachedIds: string[]
  /** Definitions invented on the form. Written, and given ids, only when the item is. */
  drafts: ModifierGroupInput[]
}

export const EMPTY_CUSTOMISATION: DraftCustomisation = { attachedIds: [], drafts: [] }
