import { useState } from 'react'
import { Link } from 'react-router'
import { LogOut, Settings } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ROLE_LABEL_KEYS } from '@/features/auth/types'
import { useAuth } from '@/features/auth/useAuth'
import { useTranslation } from '@/features/i18n/useTranslation'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  if (parts.length === 0) return '?'
  return parts.map((part) => part.charAt(0).toUpperCase()).join('')
}

/**
 * Who is signed in, and the two things they can do about it.
 *
 * Deliberately short. This menu used to carry the theme and the language as radio groups,
 * which pushed Sign out — the one thing anybody opens an account menu to find — to the
 * bottom of a list of eight, and left no room for the display name to be editable at all.
 * Both now live on the Settings page, which this links to; the menu is back to identity,
 * a way in, and a way out.
 */
export function UserMenu() {
  const { profile, signOut } = useAuth()
  const { t } = useTranslation()
  const [signingOut, setSigningOut] = useState(false)

  if (!profile) return null

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="lg" className="h-touch gap-3 px-2">
          <Avatar>
            <AvatarFallback>{initials(profile.displayName)}</AvatarFallback>
          </Avatar>
          <span className="hidden text-left sm:block">
            {/* The display name is the person's own, shown exactly as they set it. */}
            <span className="block text-sm font-medium">{profile.displayName}</span>
            <span className="block text-xs text-muted-foreground">
              {t(ROLE_LABEL_KEYS[profile.role])}
            </span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block font-medium" data-testid="menu-display-name">
            {profile.displayName}
          </span>
          <span className="block text-xs font-normal text-muted-foreground">{profile.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link to="/settings" data-testid="menu-settings">
            <Settings aria-hidden="true" />
            {t('nav.settings')}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signingOut} onSelect={() => void handleSignOut()}>
          <LogOut aria-hidden="true" />
          {signingOut ? t('common.saving') : t('account.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
