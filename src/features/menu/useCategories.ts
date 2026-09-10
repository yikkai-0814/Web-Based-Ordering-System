import { bySortOrderThenName, parseCategory, type Category } from '@/features/menu/types'
import { useCollectionDocs, useSorted, type CollectionState } from '@/features/menu/use-collection'

/** Live list of every category, ordered by sortOrder then name. */
export function useCategories(): CollectionState<Category> & { categories: Category[] } {
  const state = useSorted(useCollectionDocs('categories', parseCategory), bySortOrderThenName)
  return { ...state, categories: state.data }
}
