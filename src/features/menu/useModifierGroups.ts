import { parseModifierGroup, type ModifierGroup } from '@/features/menu/modifiers'
import { useCollectionDocs, type CollectionState } from '@/features/menu/use-collection'

/**
 * Live customisation configuration for the whole menu.
 *
 * Fetched whole and filtered in memory, exactly as the menu itself is: a café has tens of
 * items and a handful of groups each, so this avoids a composite index and — more to the
 * point — lets the till know which items ask a question without opening a listener per item.
 *
 * Readable by every active user. Staff need it to take an order; only an admin may write it,
 * which firestore.rules enforces rather than this hook.
 */
export function useModifierGroups(): CollectionState<ModifierGroup> & { groups: ModifierGroup[] } {
  const state = useCollectionDocs('modifierGroups', parseModifierGroup)
  return { ...state, groups: state.data }
}
