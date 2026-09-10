import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Admin-only placeholder. Its only job in Phase 1 is to be somewhere a staff account is
 * refused, which is what makes the role gate testable.
 */
export function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-muted-foreground">Visible only to accounts with the admin role.</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Access confirmed</CardTitle>
          <CardDescription>
            If you can read this, your account has role &ldquo;admin&rdquo; in its
            users/&#123;uid&#125; document.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          A staff account that navigates here directly is sent to the 403 page, and would also be
          refused by the security rules if it tried to read admin-only data.
        </CardContent>
      </Card>
    </div>
  )
}
