import { useContext } from 'react'

import { ThemeContext, type ThemeContextValue } from '@/features/theme/theme-context'

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>')
  return value
}
