import { createContext } from 'react'

import type { Operator } from '@/features/staff/staff-session'

export interface StaffSessionValue {
  /** The operator, or null when nobody has been selected yet. */
  operator: Operator | null
  /** Everyone the till may be used as — always including the signed-in account. */
  operators: Operator[]
  loading: boolean
  select: (operatorId: string) => void
  clear: () => void
}

/**
 * Kept in its own module so StaffSessionProvider.tsx exports a component and nothing else,
 * which is what React Fast Refresh needs — the same split as auth-context.ts.
 */
export const StaffSessionContext = createContext<StaffSessionValue | null>(null)
