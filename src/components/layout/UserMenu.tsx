import { useState } from 'react'
import { LogOut, MonitorCog, Moon, Sun } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ROLE_LABELS } from '@/features/auth/types'
import { useAuth } from '@/features/auth/useAuth'
import { THEME_LABELS, THEMES, type ThemePreference } from '@/features/theme/theme'
import { useTheme } from '@/features/theme/useTheme'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  if (parts.length === 0) return '?'
  return parts.map((part) => part.charAt(0).toUpperCase()).join('')
}

/** One icon per choice, so the menu is scannable without reading every row. */
const THEME_ICONS: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: MonitorCog,
}

export function UserMenu() {
  const { profile, signOut } = useAuth()
  const { preference, resolved, setPreference } = useTheme()
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
            <span className="block text-sm font-medium">{profile.displayName}</span>
            <span className="block text-xs text-muted-foreground">{ROLE_LABELS[profile.role]}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block font-medium">{profile.displayName}</span>
          <span className="block text-xs font-normal text-muted-foreground">{profile.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* The theme belongs to the person using this screen, so it lives with the rest of
            their session controls rather than in the navigation. */}
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(next) => setPreference(next as ThemePreference)}
        >
          {THEMES.map((candidate) => {
            const Icon = THEME_ICONS[candidate]
            return (
              <DropdownMenuRadioItem
                key={candidate}
                value={candidate}
                data-testid={`theme-${candidate}`}
              >
                <Icon aria-hidden="true" />
                {THEME_LABELS[candidate]}
                {candidate === 'system' && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {resolved === 'dark' ? 'Dark' : 'Light'}
                  </span>
                )}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signingOut} onSelect={() => void handleSignOut()}>
          <LogOut aria-hidden="true" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
