import { Navigate } from 'react-router'

import { landingPathFor } from '@/components/layout/nav-items'
import { FullPageSkeleton } from '@/components/layout/FullPageSkeleton'
import { useAuth } from '@/features/auth/useAuth'

/**
 * The index route: sends a session to wherever its role starts.
 *
 * A component rather than a bare `<Navigate to="/dashboard">` because the destination
 * depends on the profile, and the profile is only known once auth has resolved. Mounted
 * inside `RequireAuth`, which has already established there is a signed-in user — so the
 * only wait left is the role itself, and waiting is what the skeleton is for. Redirecting
 * before then would send every staff member to the admin landing for a frame.
 *
 * This is the one place that decides a default destination; anything the user explicitly
 * asked for is handled upstream, where `RequireAuth` remembers the deep link and
 * `LoginPage` returns to it.
 */
export function LandingRedirect() {
  const { status, role } = useAuth()

  if (status === 'loading') {
    return <FullPageSkeleton />
  }

  return <Navigate to={landingPathFor(role)} replace />
}
