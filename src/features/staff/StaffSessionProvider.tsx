import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { useAuth } from '@/features/auth/useAuth'
import { StaffSessionContext, type StaffSessionValue } from '@/features/staff/staff-context'
import {
  buildOperators,
  readSelectionFor,
  resolveOperator,
  serializeSelection,
  STAFF_SESSION_STORAGE_KEY,
} from '@/features/staff/staff-session'
import { useStaffMembers } from '@/features/staff/useStaffMembers'

/**
 * localStorage access, wrapped because it throws outright in some contexts (a browser set
 * to block site data, a private window). Losing the stored operator is harmless — the
 * picker simply reappears — so every failure degrades to "nobody selected".
 */
function readStoredValue(): string | null {
  try {
    return window.localStorage.getItem(STAFF_SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredValue(value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(STAFF_SESSION_STORAGE_KEY)
    else window.localStorage.setItem(STAFF_SESSION_STORAGE_KEY, value)
  } catch {
    // Ignored: the operator still works for this page load, it just will not survive a
    // refresh. Not worth interrupting service at the counter over.
  }
}

/**
 * Tracks which staff identity is operating this till.
 *
 * Not authentication. Selecting an operator proves nothing and grants nothing — the
 * signed-in Firebase role remains the only authorisation boundary. It records who is at the
 * counter so that orders can say so.
 *
 * The stored id is **re-resolved against the live list on every render**, so a member who is
 * deactivated mid-shift stops being the operator immediately, rather than the till carrying
 * an identity the server would now refuse.
 *
 * It is also **scoped to the account that chose it**. This provider is mounted above the
 * router and outside the auth guard, so it stays mounted across a sign-out — and a selection
 * that outlived the session would attribute the next person's sales to the previous one, in
 * records that are immutable. Reading it back through `readSelectionFor` means a different
 * uid simply finds nothing and is asked who is on the till. See staff-session.ts.
 *
 * The signed-in account is always an available operator, so an empty roster can never stop
 * a till from selling — see buildOperators.
 */
export function StaffSessionProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { staff, loading } = useStaffMembers()
  const uid = profile?.uid ?? null

  // What was chosen during THIS page load, and by whom. Storage is the fallback rather than
  // the seed: seeding once at mount is what let a selection outlive the account that made it.
  const [selection, setSelection] = useState<{ uid: string; operatorId: string } | null>(null)

  const selectedId = useMemo(() => {
    if (!uid) return null
    if (selection && selection.uid === uid) return selection.operatorId
    return readSelectionFor(readStoredValue(), uid)
  }, [uid, selection])

  const operators = useMemo(
    () =>
      buildOperators(
        profile ? { uid: profile.uid, displayName: profile.displayName } : null,
        staff,
      ),
    [profile, staff],
  )
  const operator = useMemo(() => resolveOperator(selectedId, operators), [selectedId, operators])

  const select = useCallback(
    (operatorId: string) => {
      // Nobody to attribute a choice to yet; the picker is not reachable in that state.
      if (!uid) return
      writeStoredValue(serializeSelection(uid, operatorId))
      setSelection({ uid, operatorId })
    },
    [uid],
  )

  const value = useMemo<StaffSessionValue>(
    () => ({ operator, operators, loading, select }),
    [operator, operators, loading, select],
  )

  return <StaffSessionContext value={value}>{children}</StaffSessionContext>
}
