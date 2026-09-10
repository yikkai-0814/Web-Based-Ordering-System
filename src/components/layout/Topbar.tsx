import { UserMenu } from '@/components/layout/UserMenu'
import { ROLE_LABELS } from '@/features/auth/types'
import { useAuth } from '@/features/auth/useAuth'

export function Topbar() {
  const { profile } = useAuth()

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b px-4 md:px-6">
      <span className="text-base font-semibold tracking-tight">Ordering System</span>
      {profile && (
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
          {ROLE_LABELS[profile.role]}
        </span>
      )}
      <div className="ml-auto">
        <UserMenu />
      </div>
    </header>
  )
}
