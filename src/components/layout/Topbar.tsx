import { useState } from 'react'
import { UserRound } from 'lucide-react'

import { UserMenu } from '@/components/layout/UserMenu'
import { Button } from '@/components/ui/button'
import { ROLE_LABELS } from '@/features/auth/types'
import { useAuth } from '@/features/auth/useAuth'
import { StaffPicker } from '@/features/staff/StaffPicker'
import { useStaffSession } from '@/features/staff/useStaffSession'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

export function Topbar() {
  const { profile } = useAuth()
  const { operator } = useStaffSession()
  const [switching, setSwitching] = useState(false)

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:gap-4 md:px-6">
      <span className="font-heading text-base font-semibold tracking-tight">Ordering System</span>
      {profile && (
        <span className="hidden rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground sm:inline">
          {ROLE_LABELS[profile.role]}
        </span>
      )}

      {/* Who is on the till, always visible. Attribution that nobody can see deters
          nothing — this is the whole security value the architecture can actually give. */}
      {operator && (
        <AlertDialog open={switching} onOpenChange={setSwitching}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 gap-2 rounded-full border bg-background/60"
              data-testid="switch-operator"
            >
              <UserRound className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden text-muted-foreground sm:inline">Operating as</span>
              <span className="min-w-0 truncate font-medium" data-testid="current-operator">
                {operator.name}
              </span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Switch operator</AlertDialogTitle>
              <AlertDialogDescription>
                Orders taken from now on are recorded against whoever is selected. Anything already
                in the cart stays there, so finish or clear it first.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <StaffPicker onSelected={() => setSwitching(false)} />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <div className="ml-auto">
        <UserMenu />
      </div>
    </header>
  )
}
