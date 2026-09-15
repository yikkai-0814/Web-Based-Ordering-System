import { useMemo } from 'react'

import { useAuth } from '@/features/auth/useAuth'
import {
  modifierCostKey,
  parseModifierOptionCost,
  type ModifierOptionCost,
} from '@/features/menu/modifier-cost'
import { useCollectionDocs } from '@/features/menu/use-collection'

/**
 * Live map of `groupId__optionId` -> cost in sen, for admins only.
 *
 * The exact shape of `useItemCosts`, and for the same reason: staff never subscribe, so the
 * read is not even attempted by an account the rules would refuse. That refusal is the real
 * boundary — skipping the subscription here only keeps staff from being shown an error about
 * a collection whose existence is not their concern.
 *
 * Keyed by `modifierCostKey` rather than by option id alone, because option ids are unique
 * only within their group.
 */
export function useModifierOptionCosts(): { costs: Map<string, number>; loading: boolean } {
  const { role } = useAuth()
  const isAdmin = role === 'admin'

  const state = useCollectionDocs<ModifierOptionCost>(
    'modifierOptionCosts',
    parseModifierOptionCost,
    isAdmin,
  )

  const costs = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of state.data) {
      map.set(modifierCostKey(entry.groupId, entry.optionId), entry.cost)
    }
    return map
  }, [state.data])

  return { costs, loading: state.loading }
}
