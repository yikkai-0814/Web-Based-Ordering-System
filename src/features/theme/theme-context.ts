import { createContext } from 'react'

import type { ResolvedTheme, ThemePreference } from '@/features/theme/theme'

export interface ThemeContextValue {
  /** What the user chose: light, dark, or follow the system. */
  preference: ThemePreference
  /** What that currently resolves to — the palette actually on screen. */
  resolved: ResolvedTheme
  setPreference: (next: ThemePreference) => void
}

/**
 * Kept in its own module so ThemeProvider.tsx exports a component and nothing else, which is
 * what React Fast Refresh needs — the same split as auth-context.ts and staff-context.ts.
 */
export const ThemeContext = createContext<ThemeContextValue | null>(null)
