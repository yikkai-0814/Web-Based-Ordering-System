import { Navigate, Outlet } from 'react-router'

import type { Role } from '@/features/auth/types'
import { useAuth } from '@/features/auth/useAuth'
import { FullPageSkeleton } from '@/components/layout/FullPageSkeleton'

/**
 * Wraps a group of routes that only certain roles may open. Nest it inside
 * <RequireAuth />, which has already established that there is a signed-in user.
 */
export function RequireRole({ allow }: { allow: readonly Role[] }) {
  const { status, role } = useAuth()

  if (status === 'loading') {
    return <FullPageSkeleton />
  }

  if (!role || !allow.includes(role)) {
    return <Navigate to="/403" replace />
  }

  return <Outlet />
}
