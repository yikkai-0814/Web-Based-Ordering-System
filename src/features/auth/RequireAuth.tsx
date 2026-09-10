import { Navigate, Outlet, useLocation } from 'react-router'

import { useAuth } from '@/features/auth/useAuth'
import { FullPageSkeleton } from '@/components/layout/FullPageSkeleton'

/**
 * Route guard for anything that needs a signed-in, active account.
 *
 * This is user experience, not security. It stops a staff member wandering into a page
 * they cannot use; it does not stop anyone reading data, which is what firestore.rules
 * is for.
 */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <FullPageSkeleton />
  }

  if (status === 'unauthenticated') {
    // `state.from` is what LoginPage returns to after a successful sign-in, so a
    // bookmarked deep link survives the detour through the login screen.
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}
