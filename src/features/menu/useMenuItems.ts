import { bySortOrderThenName, parseMenuItem, type MenuItem } from '@/features/menu/types'
import { useCollectionDocs, useSorted, type CollectionState } from '@/features/menu/use-collection'

/** Live list of every menu item, ordered by sortOrder then name. */
export function useMenuItems(): CollectionState<MenuItem> & { items: MenuItem[] } {
  const state = useSorted(useCollectionDocs('menuItems', parseMenuItem), bySortOrderThenName)
  return { ...state, items: state.data }
}
