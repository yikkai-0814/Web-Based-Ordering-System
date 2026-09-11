import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { useAuth } from '@/features/auth/useAuth'
import { StaffSessionContext, type StaffSessionValue } from '@/features/staff/staff-context'
import {
  buildOperators,
  resolveOperator,
  STAFF_SESSION_STORAGE_KEY,
} from '@/features/staff/staff-session'
import { useStaffMembers } from '@/features/staff/useStaffMembers'

/**
 * localStorage access, wrapped because it throws outright in some contexts (a browser set
 * to block site data, a private window). Losing the stored operator is harmless — the
 * picker simply reappears — so every failure degrades to "nobody selected".
 */
function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(STAFF_SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredId(value: string | null): void {
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
 * The signed-in account is always an available operator, so an empty roster can never stop
 * a till from selling — see buildOperators.
 */
export function StaffSessionProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const { staff, loading } = useStaffMembers()
  const [selectedId, setSelectedId] = useState<string | null>(() => readStoredId())

  const operators = useMemo(
    () =>
      buildOperators(
        profile ? { uid: profile.uid, displayName: profile.displayName } : null,
        staff,
      ),
    [profile, staff],
  )
  const operator = useMemo(() => resolveOperator(selectedId, operators), [selectedId, operators])

  const select = useCallback((operatorId: string) => {
    writeStoredId(operatorId)
    setSelectedId(operatorId)
  }, [])

  const clear = useCallback(() => {
    writeStoredId(null)
    setSelectedId(null)
  }, [])

  const value = useMemo<StaffSessionValue>(
    () => ({ operator, operators, loading, select, clear }),
    [operator, operators, loading, select, clear],
  )

  return <StaffSessionContext value={value}>{children}</StaffSessionContext>
}
