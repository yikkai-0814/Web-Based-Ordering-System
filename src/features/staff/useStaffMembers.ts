import { useAuth } from '@/features/auth/useAuth'
import { useCollectionDocs, useSorted, type CollectionState } from '@/features/menu/use-collection'
import { byName, parseStaffMember, type StaffMember } from '@/features/staff/types'

/**
 * Live roster, ordered by name. Readable by any active user — the till picker needs it.
 *
 * **The subscription is gated on being signed in, and that gate is load-bearing.**
 *
 * StaffSessionProvider mounts outside the auth guard, so without this it would subscribe
 * while the user is still signed out. Firestore refuses that read, and a permission-denied
 * *terminates* the listener — it does not retry. Since `useCollectionDocs` only re-runs its
 * effect when `path`, `parse` or `enabled` change, the dead listener would never be
 * replaced, and the roster would stay permanently empty for that page session: a staff
 * member created afterwards would never appear in the picker until a full page reload.
 *
 * Passing `enabled` flips false -> true the moment auth resolves, which re-runs the effect
 * and creates a fresh listener with a valid token. Same mechanism `useItemCosts` uses for
 * the admin-only cost collections.
 */
export function useStaffMembers(): CollectionState<StaffMember> & { staff: StaffMember[] } {
  const { profile } = useAuth()
  const state = useSorted(
    useCollectionDocs('staffMembers', parseStaffMember, Boolean(profile)),
    byName,
  )
  return { ...state, staff: state.data }
}
