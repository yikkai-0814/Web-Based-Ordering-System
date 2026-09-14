// @vitest-environment jsdom
/**
 * The Settings page: the one screen that writes to somebody's own profile.
 *
 * The rules around renaming are enforced at the database and proven in tests/rules — a
 * self-write that touches anything but `displayName` is refused there, and that is the
 * control. What is proven here is the half the rules cannot see: that the form refuses a
 * name the rules would refuse, that it sends exactly one field, that a refusal is reported
 * as something a person can act on, and that the theme and language controls that moved off
 * the account menu still reach their providers.
 */
import { screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsPage } from '@/features/settings/SettingsPage'
import { LANGUAGE_STORAGE_KEY } from '@/features/i18n/languages'
import { ThemeProvider } from '@/features/theme/ThemeProvider'

import { renderComponent } from './render'

const updateDisplayName = vi.hoisted(() => vi.fn())

vi.mock('@/features/auth/profile-api', () => ({ updateDisplayName }))

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => ({
    profile: {
      uid: 'u1',
      displayName: 'Ada Admin',
      email: 'ada@example.test',
      role: 'admin',
      active: true,
      createdAt: null,
    },
    signOut: async () => {},
  }),
}))

/** jsdom has no matchMedia, and ThemeProvider consults it on mount. */
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  )
  window.localStorage.clear()
  updateDisplayName.mockReset()
  updateDisplayName.mockResolvedValue(undefined)
})

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('lang')
  document.documentElement.classList.remove('dark')
  vi.unstubAllGlobals()
})

function renderSettings() {
  return renderComponent(
    <MemoryRouter>
      <ThemeProvider>
        <SettingsPage />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

const nameField = () => screen.getByTestId('display-name') as HTMLInputElement
const saveButton = () => screen.getByTestId('save-display-name') as HTMLButtonElement

describe('the account panel', () => {
  it('starts from the name the profile already has', () => {
    renderSettings()
    expect(nameField().value).toBe('Ada Admin')
  })

  it('shows the email but does not let it be edited', () => {
    renderSettings()
    const email = screen.getByTestId('account-email') as HTMLInputElement
    expect(email.value).toBe('ada@example.test')
    expect(email.readOnly).toBe(true)
    expect(email.getAttribute('aria-readonly')).toBe('true')
  })

  it('will not save a name that has not changed', () => {
    renderSettings()
    expect(saveButton().disabled).toBe(true)
  })

  it('saves a new name, sending only the display name', async () => {
    const { user } = renderSettings()
    await user.clear(nameField())
    await user.type(nameField(), 'Ada Lovelace')
    await user.click(saveButton())

    expect(updateDisplayName).toHaveBeenCalledTimes(1)
    expect(updateDisplayName).toHaveBeenCalledWith('u1', 'Ada Lovelace')
  })

  it('stores the trimmed name, and shows what it stored', async () => {
    const { user } = renderSettings()
    await user.clear(nameField())
    await user.type(nameField(), '  Ada Lovelace  ')
    await user.click(saveButton())

    expect(updateDisplayName).toHaveBeenCalledWith('u1', 'Ada Lovelace')
    expect(nameField().value).toBe('Ada Lovelace')
  })

  it('confirms a save where the action was', async () => {
    const { user } = renderSettings()
    await user.clear(nameField())
    await user.type(nameField(), 'Ada Lovelace')
    await user.click(saveButton())

    expect(await screen.findByTestId('display-name-saved')).not.toBeNull()
    expect(screen.getByTestId('display-name-saved').textContent).toContain('Saved')
  })

  it('refuses a blank name without asking the database', async () => {
    const { user } = renderSettings()
    await user.clear(nameField())
    await user.type(nameField(), '   ')
    await user.click(saveButton())

    expect(updateDisplayName).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a display name.')).not.toBeNull()
  })

  it('reports a refusal as something a person can act on', async () => {
    updateDisplayName.mockRejectedValue(new Error('permission-denied'))
    const { user } = renderSettings()
    await user.clear(nameField())
    await user.type(nameField(), 'Ada Lovelace')
    await user.click(saveButton())

    expect(
      await screen.findByText(/That change could not be saved\. Your account may not have/),
    ).not.toBeNull()
    // Not left looking like it worked.
    expect(screen.queryByTestId('display-name-saved')).toBeNull()
  })
})

describe('the appearance panel', () => {
  it('paints the document when a tile is chosen', async () => {
    const { user } = renderSettings()
    await user.click(screen.getByTestId('theme-dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('marks exactly one tile as chosen', async () => {
    const { user } = renderSettings()
    await user.click(screen.getByTestId('theme-light'))
    const checked = ['light', 'dark', 'system'].filter(
      (choice) => screen.getByTestId(`theme-${choice}`).getAttribute('aria-checked') === 'true',
    )
    expect(checked).toEqual(['light'])
  })
})

describe('the language panel', () => {
  it('changes the interface and tells the document', async () => {
    const { user } = renderSettings()
    await user.click(screen.getByTestId('language-ms'))

    expect(screen.getByText('Tetapan')).not.toBeNull()
    expect(document.documentElement.getAttribute('lang')).toBe('ms')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ms')
  })

  it('names each language in itself, whatever the interface is set to', async () => {
    const { user } = renderSettings()
    await user.click(screen.getByTestId('language-zh'))

    // Still the endonyms — somebody looking for 中文 is not looking for "Chinese".
    expect(screen.getByTestId('language-en').textContent).toBe('English')
    expect(screen.getByTestId('language-ms').textContent).toBe('Bahasa Melayu')
    expect(screen.getByTestId('language-zh').textContent).toBe('中文')
  })

  it('leaves the name the person typed alone when the language changes', async () => {
    const { user } = renderSettings()
    await user.clear(nameField())
    await user.type(nameField(), 'Aminah binti Hassan')
    await user.click(screen.getByTestId('language-zh'))

    expect(nameField().value).toBe('Aminah binti Hassan')
  })
})
