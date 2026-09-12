/**
 * Which palette the application draws itself in.
 *
 * Pure by design, like staff-session.ts: the rules about what a stored value means, and what
 * a preference resolves to, are decided here and tested without a browser. The provider does
 * nothing but wire these to `document` and `matchMedia`.
 */

/** Per-device, because a theme is about the screen in front of somebody, not their account. */
export const THEME_STORAGE_KEY = 'ordering-system.theme'

export const THEMES = ['light', 'dark', 'system'] as const

export type ThemePreference = (typeof THEMES)[number]

/** What the preference actually resolves to once the system has been consulted. */
export type ResolvedTheme = 'light' | 'dark'

export const THEME_LABELS: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

/**
 * Reads a stored preference back.
 *
 * Anything unrecognised — a value from an older build, a half-written string, a key somebody
 * set by hand — falls back to following the system rather than guessing at light or dark.
 * Following the system is the one answer that is never wrong for long.
 */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return THEMES.includes(raw as ThemePreference) ? (raw as ThemePreference) : 'system'
}

/**
 * The palette to paint, given what was chosen and what the operating system says.
 *
 * `system` is a live answer, not a snapshot taken at startup: the provider re-resolves this
 * whenever the OS setting changes, so a till that dims itself in the evening follows along
 * without anybody touching the app.
 */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}
