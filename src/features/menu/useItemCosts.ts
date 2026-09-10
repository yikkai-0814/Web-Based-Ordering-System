import { useMemo } from 'react'

import { parseItemCost, type ItemCost } from '@/features/menu/types'
import { useCollectionDocs } from '@/features/menu/use-collection'
import { useAuth } from '@/features/auth/useAuth'

/**
 * Live map of item id -> cost in sen, for admins only.
 *
 * Staff never subscribe: `enabled` is false for them, so the read is not even attempted.
 * That is belt-and-braces on top of the rules, which would refuse it anyway — the point of
 * skipping it here is that staff should not see a permission error for a collection whose
 * existence is not their concern.
 */
export function useItemCosts(): { costs: Map<string, number>; loading: boolean } {
  const { role } = useAuth()
  const isAdmin = role === 'admin'

  const state = useCollectionDocs<ItemCost>('menuItemCosts', parseItemCost, isAdmin)

  const costs = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of state.data) map.set(entry.itemId, entry.cost)
    return map
  }, [state.data])

  return { costs, loading: state.loading }
}
