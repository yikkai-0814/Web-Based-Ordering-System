// @vitest-environment jsdom
/**
 * Light, dark, and following the machine.
 *
 * The rule about what a preference resolves to is proven in tests/unit. What is proven here
 * is that something acts on it: one class on `<html>`, chosen through the user menu, surviving
 * a reload, and following the operating system when asked to.
 *
 * jsdom has no `matchMedia`, so it is stubbed — which is also how the OS is made to "change"
 * its mind mid-test.
 */
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MemoryRouter } from 'react-router'

import { UserMenu } from '@/components/layout/UserMenu'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { THEME_STORAGE_KEY } from '@/features/theme/theme'
import { ThemeProvider } from '@/features/theme/ThemeProvider'
import { useTheme } from '@/features/theme/useTheme'

import { renderComponent } from './render'

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    profile: { uid: 'u1', displayName: 'Ada Admin', email: 'ada@example.test', role: 'admin' },
    signOut: async () => {},
  }),
}))

/** Listeners the fake media query has handed out, so a test can fire a system change. */
let systemDark = false
let listeners: Array<() => void> = []

function installMatchMedia() {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('dark') && systemDark,
        media: query,
        addEventListener: (_: string, listener: () => void) => listeners.push(listener),
        removeEventListener: (_: string, listener: () => void) => {
          listeners = listeners.filter((candidate) => candidate !== listener)
        },
      }) as unknown as MediaQueryList,
  )
}

function setSystemDark(next: boolean) {
  systemDark = next
  for (const listener of [...listeners]) listener()
}

function Consumer() {
  const { preference, resolved, setPreference } = useTheme()
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button type="button" onClick={() => setPreference('dark')}>
        Dark
      </button>
      <button type="button" onClick={() => setPreference('light')}>
        Light
      </button>
      <button type="button" onClick={() => setPreference('system')}>
        System
      </button>
    </div>
  )
}

const renderTheme = () =>
  renderComponent(
    <ThemeProvider>
      <Consumer />
    </ThemeProvider>,
  )

const isDark = () => document.documentElement.classList.contains('dark')
const resolved = () => screen.getByTestId('resolved').textContent

beforeEach(() => {
  systemDark = false
  listeners = []
  installMatchMedia()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('ThemeProvider: choosing a palette', () => {
  it('follows the system until somebody says otherwise', () => {
    renderTheme()
    expect(screen.getByTestId('preference').textContent).toBe('system')
    expect(resolved()).toBe('light')
    expect(isDark()).toBe(false)
  })

  it('paints the whole document dark, not one component', async () => {
    // The class goes on <html>, which is what every CSS variable in the app hangs off — so
    // the sidebar, tables, dialogs and inputs all follow without knowing about the theme.
    const { user } = renderTheme()
    await user.click(screen.getByText('Dark'))

    expect(isDark()).toBe(true)
    expect(resolved()).toBe('dark')
  })

  it('goes back to light again', async () => {
    const { user } = renderTheme()
    await user.click(screen.getByText('Dark'))
    await user.click(screen.getByText('Light'))

    expect(isDark()).toBe(false)
    expect(resolved()).toBe('light')
  })

  it('tells the browser which scheme its own controls should use', () => {
    // Without this the date pickers on the Reports page stay stubbornly light on a dark page.
    renderTheme()
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})

describe('ThemeProvider: following the system', () => {
  it('starts dark when the machine is already dark', () => {
    systemDark = true
    renderTheme()
    expect(resolved()).toBe('dark')
    expect(isDark()).toBe(true)
  })

  it('follows the machine changing its mind while the app is open', async () => {
    // A till left running as the office lights go down should come with it.
    const { user } = renderTheme()
    await user.click(screen.getByText('System'))
    expect(isDark()).toBe(false)

    setSystemDark(true)
    expect(await screen.findByText('dark')).not.toBeNull()
    expect(isDark()).toBe(true)
  })

  it('ignores the machine once a choice has been made', async () => {
    const { user } = renderTheme()
    await user.click(screen.getByText('Light'))

    setSystemDark(true)
    expect(resolved()).toBe('light')
    expect(isDark()).toBe(false)
  })
})

describe('ThemeProvider: persistence', () => {
  it('survives a reload', async () => {
    const first = renderTheme()
    await first.user.click(screen.getByText('Dark'))
    first.unmount()

    renderTheme()
    expect(screen.getByTestId('preference').textContent).toBe('dark')
    expect(isDark()).toBe(true)
  })

  it('restores "system" as a live choice rather than a frozen palette', async () => {
    const first = renderTheme()
    await first.user.click(screen.getByText('System'))
    first.unmount()

    systemDark = true
    renderTheme()
    expect(screen.getByTestId('preference').textContent).toBe('system')
    expect(resolved()).toBe('dark')
  })

  it('ignores a stored value it does not recognise', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia')
    renderTheme()
    expect(screen.getByTestId('preference').textContent).toBe('system')
  })
})

describe('the switcher on the Settings page', () => {
  it('changes the palette for the whole document', async () => {
    // Where it lives matters. It used to be a radio group inside the account dropdown, which
    // could not explain itself and buried Sign out; it is now a panel of preview tiles on
    // Settings, and what it does is unchanged.
    const { user } = renderComponent(
      <ThemeProvider>
        <SettingsPage />
      </ThemeProvider>,
    )

    await user.click(screen.getByTestId('theme-dark'))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('offers all three choices and marks the current one', () => {
    renderComponent(
      <ThemeProvider>
        <SettingsPage />
      </ThemeProvider>,
    )

    for (const choice of ['light', 'dark', 'system']) {
      expect(screen.getByTestId(`theme-${choice}`)).not.toBeNull()
    }
    // Nothing chosen yet, so "System" is the one selected.
    expect(screen.getByTestId('theme-system').getAttribute('aria-checked')).toBe('true')
  })

  it('is no longer offered inside the account menu', async () => {
    const { user } = renderComponent(
      <MemoryRouter>
        <ThemeProvider>
          <UserMenu />
        </ThemeProvider>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: /Ada Admin/ }))

    for (const choice of ['light', 'dark', 'system']) {
      expect(screen.queryByTestId(`theme-${choice}`)).toBeNull()
    }
    // What it offers instead: a way to the page that now holds them.
    expect(screen.getByTestId('menu-settings').getAttribute('href')).toBe('/settings')
  })
})
