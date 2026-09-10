import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ROLE_LABELS } from '@/features/auth/types'
import { useAuth } from '@/features/auth/useAuth'

/** Placeholder landing page for both roles. Café functionality arrives in later phases. */
export function DashboardPage() {
  const { profile } = useAuth()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome{profile ? `, ${profile.displayName}` : ''}
        </h1>
        <p className="text-muted-foreground">
          You are signed in as {profile ? ROLE_LABELS[profile.role] : 'a user'}.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Foundation only</CardTitle>
          <CardDescription>
            Phase 1 covers sign-in, roles, and access control. Ordering, menu, and sales features
            are not built yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Everything visible here is a placeholder that proves the shell, the role-aware navigation,
          and the security rules work end to end.
        </CardContent>
      </Card>
    </div>
  )
}
