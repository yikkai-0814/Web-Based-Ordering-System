// @vitest-environment jsdom
/**
 * The sign-in screen.
 *
 * It had no tests of its own — `route-access` mocks it away, because what that suite is
 * asking is which page a role reaches, not what is on it. This covers the page itself, and
 * most of what it asserts is that the polish did NOT change the thing underneath: the same
 * validation, the same call to `signIn` with the same two arguments, the same clearing of the
 * password after a refusal, the same redirect once the auth listener flips.
 *
 * The new behaviour is the reveal control and the submitting state, both presentation only.
 */
import { screen } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '@/features/theme/ThemeProvider'
import { LANGUAGE_STORAGE_KEY } from '@/features/i18n/languages'
import { THEME_STORAGE_KEY } from '@/features/theme/theme'

import { renderComponent } from './render'

const signIn = vi.hoisted(() => vi.fn())
let auth: Record<string, unknown>

vi.mock('@/features/auth/useAuth', () => ({
  useAuth: () => auth,
}))

import { LoginPage } from '@/features/auth/LoginPage'

/**
 * Wrapped in the theme provider as well as the language one, because the page now offers
 * both device settings — the same two the Settings page offers, reading the same providers.
 */
function renderLogin() {
  return renderComponent(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/pos" element={<p>New Order</p>} />
          <Route path="/dashboard" element={<p>Dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

const email = () => screen.getByLabelText('Email') as HTMLInputElement
const password = () => screen.getByLabelText('Password') as HTMLInputElement
const reveal = () => screen.getByTestId('toggle-password')
const submit = () => screen.getByRole('button', { name: /Sign in/ })

beforeEach(() => {
  signIn.mockReset()
  signIn.mockResolvedValue(undefined)
  auth = { status: 'unauthenticated', role: null, signIn, rejectionMessage: null }
  // Both settings are per-device and persist; one test must not inherit another's.
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('what the page presents', () => {
  it('names the product quietly, as text and nothing else', () => {
    renderLogin()

    const brand = screen.getByText('Ordering System')
    expect(brand).not.toBeNull()
    // An eyebrow above the heading, not a wordmark: small, muted, and with no icon beside it.
    expect(brand.className).toContain('text-xs')
    expect(brand.className).toContain('text-muted-foreground')
    expect(brand.querySelector('svg')).toBeNull()
  })

  it('leads with the heading and one welcome line', () => {
    renderLogin()

    // Asked of the card's own title rather than of the page, because the submit button says
    // the same two words — which is the point: the heading names the task, the button does it.
    expect(document.querySelector('[data-slot="card-title"]')?.textContent).toBe('Sign in')
    expect(screen.getByText('Welcome back! Please enter your details.')).not.toBeNull()
  })

  it('says where to go for an account, as a footnote under the card', () => {
    renderLogin()

    // It answers the one question this page cannot: there is no sign-up and no reset flow,
    // so it names the person who can help rather than linking to neither.
    expect(screen.getByText('Need an account? Contact your administrator.')).not.toBeNull()
    expect(screen.queryByRole('link', { name: /forgot/i })).toBeNull()
  })

  it('shows a leading icon on each field without disturbing them', () => {
    renderLogin()

    // Decoration: hidden from assistive technology, and not in the way of a click either.
    for (const field of [email(), password()]) {
      const icon = field.parentElement?.querySelector('svg')
      expect(icon?.getAttribute('aria-hidden')).toBe('true')
      expect(icon?.getAttribute('class')).toContain('pointer-events-none')
    }
  })

  it('keeps both fields labelled and autocompleting as they were', () => {
    renderLogin()

    expect(email().type).toBe('email')
    expect(email().getAttribute('autocomplete')).toBe('username')
    expect(password().getAttribute('autocomplete')).toBe('current-password')
    expect(email().required).toBe(true)
    expect(password().required).toBe(true)
  })
})

describe('showing and hiding the password', () => {
  it('starts covered', () => {
    renderLogin()

    expect(password().type).toBe('password')
    expect(reveal().getAttribute('aria-pressed')).toBe('false')
    expect(reveal().getAttribute('aria-label')).toBe('Show password')
  })

  it('is a button, not a submit — a click must never try to sign in', async () => {
    const { user } = renderLogin()

    expect(reveal().getAttribute('type')).toBe('button')
    await user.click(reveal())

    expect(signIn).not.toHaveBeenCalled()
  })

  it('reveals and covers again, saying which it will do next', async () => {
    const { user } = renderLogin()

    await user.click(reveal())
    expect(password().type).toBe('text')
    expect(reveal().getAttribute('aria-pressed')).toBe('true')
    expect(reveal().getAttribute('aria-label')).toBe('Hide password')

    await user.click(reveal())
    expect(password().type).toBe('password')
    expect(reveal().getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps what was typed when it is toggled', async () => {
    const { user } = renderLogin()

    await user.type(password(), 'hunter2')
    await user.click(reveal())

    expect(password().value).toBe('hunter2')
  })
})

describe('validation, unchanged', () => {
  it('asks for an email before anything is sent', async () => {
    const { user } = renderLogin()

    await user.click(submit())

    expect(signIn).not.toHaveBeenCalled()
    expect(screen.getByText('Enter your email and password.')).not.toBeNull()
  })

  it('refuses something that is not an email address', async () => {
    const { user } = renderLogin()

    await user.type(email(), 'not-an-address')
    await user.type(password(), 'hunter2')
    await user.click(submit())

    expect(signIn).not.toHaveBeenCalled()
    expect(screen.getByText('That does not look like an email address.')).not.toBeNull()
  })

  it('asks for a password', async () => {
    const { user } = renderLogin()

    await user.type(email(), 'admin@example.com')
    await user.click(submit())

    expect(signIn).not.toHaveBeenCalled()
    expect(screen.getByText('Please enter your password.')).not.toBeNull()
  })
})

describe('signing in, unchanged', () => {
  it('hands the credentials to the auth layer exactly as typed', async () => {
    const { user } = renderLogin()

    await user.type(email(), 'admin@example.com')
    await user.type(password(), 'password123')
    await user.click(submit())

    expect(signIn).toHaveBeenCalledWith('admin@example.com', 'password123')
  })

  it('empties the password and covers it again when the credentials are refused', async () => {
    signIn.mockRejectedValue(new FirebaseError('auth/invalid-credential', 'refused'))
    const { user } = renderLogin()

    await user.type(email(), 'admin@example.com')
    await user.type(password(), 'wrong')
    await user.click(reveal())
    await user.click(submit())

    expect(screen.getByText('That email or password is not correct.')).not.toBeNull()
    expect(password().value).toBe('')
    // A shared terminal faces a counter: the next attempt starts covered.
    expect(password().type).toBe('password')
    expect(reveal().getAttribute('aria-pressed')).toBe('false')
  })

  it('shows why a previous session was ended when there is no form error', () => {
    auth = {
      status: 'unauthenticated',
      role: null,
      signIn,
      rejectionMessage: { key: 'auth.error.inactive' },
    }
    renderLogin()

    expect(screen.getByRole('alert')).not.toBeNull()
  })

  it('redirects once the auth listener says the session is good', () => {
    auth = { status: 'authenticated', role: 'staff', signIn, rejectionMessage: null }
    renderLogin()

    expect(screen.getByText('New Order')).not.toBeNull()
  })
})

describe('the submitting state', () => {
  it('says so, marks itself busy and cannot be pressed twice', async () => {
    // Held open so the pending render can be inspected, then released.
    let release = () => {}
    signIn.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            resolve()
          }
        }),
    )

    const { user } = renderLogin()
    await user.type(email(), 'admin@example.com')
    await user.type(password(), 'password123')
    await user.click(submit())

    const button = screen.getByRole('button', { name: /Signing in/ })
    expect(button.textContent).toContain('Signing in')
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(true)
    // The spinner is decoration; `aria-busy` is what is announced.
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    // Everything else is out of reach while the request is in flight, as before.
    expect(email().disabled).toBe(true)
    expect(password().disabled).toBe(true)
    expect((reveal() as HTMLButtonElement).disabled).toBe(true)

    release()
  })
})

/**
 * The language and the theme, before there is an account to hang them on.
 *
 * Both are per-device settings that already existed in the application; what is new is that
 * they are reachable from the one screen nobody has signed in to yet. A till set to Malay
 * should say so before its first field, not after. They read and write the same providers the
 * Settings page does, which is what these assert — not a second copy of either preference.
 */
describe('the device settings in the corner', () => {
  it('offers the language, named in itself', async () => {
    const { user } = renderLogin()

    const trigger = screen.getByTestId('login-language')
    expect(trigger.textContent).toContain('English')

    await user.click(trigger)
    expect(screen.getByTestId('login-language-ms').textContent).toBe('Bahasa Melayu')
    expect(screen.getByTestId('login-language-zh').textContent).toBe('中文')
  })

  it('says what the control is for without hiding the language it shows', () => {
    renderLogin()

    // The accessible name has to contain the visible text, so the purpose is a hidden prefix
    // rather than an aria-label that would replace the endonym.
    expect(screen.getByTestId('login-language').textContent).toContain('Language')
    expect(screen.getByRole('button', { name: /English/ })).not.toBeNull()
  })

  it('switches the whole page into the chosen language, and remembers it', async () => {
    const { user } = renderLogin()

    await user.click(screen.getByTestId('login-language'))
    await user.click(screen.getByTestId('login-language-ms'))

    expect(screen.getByLabelText('Kata laluan')).not.toBeNull()
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ms')
  })

  it('offers the same three themes the Settings page does', async () => {
    const { user } = renderLogin()

    await user.click(screen.getByTestId('login-theme'))

    expect(screen.getByTestId('login-theme-light').textContent).toContain('Light')
    expect(screen.getByTestId('login-theme-dark').textContent).toContain('Dark')
    expect(screen.getByTestId('login-theme-system').textContent).toContain('System')
  })

  it('applies a chosen theme to the document and remembers it', async () => {
    const { user } = renderLogin()

    await user.click(screen.getByTestId('login-theme'))
    await user.click(screen.getByTestId('login-theme-dark'))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('is labelled for a screen reader, being an icon alone', () => {
    renderLogin()

    expect(screen.getByRole('button', { name: 'Appearance' })).toBe(
      screen.getByTestId('login-theme'),
    )
  })
})
