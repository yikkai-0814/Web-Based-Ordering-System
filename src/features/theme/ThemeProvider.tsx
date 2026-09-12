import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { ThemeContext, type ThemeContextValue } from '@/features/theme/theme-context'
import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '@/features/theme/theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * localStorage access, wrapped because it throws outright in some contexts (a browser set to
 * block site data, a private window). Losing the stored theme is harmless — the app follows
 * the system instead — so every failure degrades to "system".
 */
function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

function writeStoredPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Ignored: the theme still applies for this page load, it just will not survive a
    // refresh. Not worth interrupting service at the counter over.
  }
}

/** jsdom and older browsers do not implement matchMedia; neither should crash the app. */
function prefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches
  } catch {
    return false
  }
}

/**
 * The OS colour-scheme setting, subscribed to as what it is: an external store.
 *
 * `useSyncExternalStore` rather than state-plus-effect because the value lives outside React
 * — reading it into state and then syncing it back would mean an extra render on every mount
 * and a window where the two disagree.
 */
function subscribeToSystemTheme(onChange: () => void): () => void {
  let media: MediaQueryList
  try {
    media = window.matchMedia(DARK_QUERY)
  } catch {
    return () => {}
  }
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/**
 * Paints the whole application light or dark.
 *
 * One class on `<html>` and the entire palette follows, because every colour in the app is
 * already a CSS variable with a value in both `:root` and `.dark` — sidebar, cards, tables,
 * dialogs, inputs, badges, meters and page background alike. There is no second theme system
 * here and no component that themes itself; anything that did would be the bug.
 *
 * `color-scheme` is set alongside the class, which is what makes the browser's own furniture
 * — form controls, scrollbars, the date pickers on the Reports page — follow the theme
 * instead of staying stubbornly light on a dark page.
 *
 * Mounted outside everything else in App.tsx, so the theme is settled before the first screen
 * paints and applies to the login page as much as to the till.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference())

  // "System" is a live answer, not one taken at startup: a machine that switches to dark in
  // the evening takes the app with it, with nobody touching a setting.
  const systemDark = useSyncExternalStore(
    subscribeToSystemTheme,
    prefersDark,
    // Server snapshot: there is no OS to ask, and light is the safer default to paint first.
    () => false,
  )

  const resolved = resolveTheme(preference, systemDark)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    root.style.colorScheme = resolved
  }, [resolved])

  const setPreference = useCallback((next: ThemePreference) => {
    writeStoredPreference(next)
    setPreferenceState(next)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}
