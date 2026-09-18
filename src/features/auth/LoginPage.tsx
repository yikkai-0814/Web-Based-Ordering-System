import { useTranslation } from '@/features/i18n/useTranslation'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import {
  AlertCircle,
  Eye,
  EyeOff,
  Languages,
  LoaderCircle,
  Lock,
  Mail,
  MonitorCog,
  Moon,
  Sun,
} from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { landingPathFor } from '@/components/layout/nav-items'
import { useAuth } from '@/features/auth/useAuth'
import { LANGUAGE_LABELS, LANGUAGES, type Language } from '@/features/i18n/languages'
import { message, type Message } from '@/features/i18n/messages'
import { THEME_LABEL_KEYS, THEMES, type ThemePreference } from '@/features/theme/theme'
import { useTheme } from '@/features/theme/useTheme'
import { authErrorMessage } from '@/lib/auth-errors'

/** Deliberately minimal — one form does not justify a form library. */
function validate(email: string, password: string): Message | null {
  if (!email.trim()) return message('validation.loginRequired')
  if (!email.includes('@')) return message('validation.emailFormat')
  if (!password) return message('auth.error.missingPassword')
  return null
}

interface LocationState {
  from?: { pathname?: string }
}

export function LoginPage() {
  const { t } = useTranslation()
  const { status, role, signIn, rejectionMessage } = useAuth()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<Message | null>(null)
  const [pending, setPending] = useState(false)
  /**
   * Whether the password is being shown.
   *
   * Presentation only — the field's `name`, `autoComplete` and value are the same either way,
   * so nothing about what is submitted or how it is validated depends on this.
   */
  const [revealed, setRevealed] = useState(false)

  // Where RequireAuth wanted to go before it detoured through here. Falling back to the
  // role's own landing page rather than a fixed one, so a staff member who simply signed in
  // arrives at New Order — while a deep link they actually asked for still wins.
  const from = (location.state as LocationState | null)?.from?.pathname ?? landingPathFor(role)

  if (status === 'authenticated') {
    return <Navigate to={from} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validate(email, password)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setPending(true)
    try {
      await signIn(email, password)
      // On success the auth listener flips `status`, and the redirect above takes over.
    } catch (caught) {
      setError(authErrorMessage(caught))
      setPassword('')
      // The field is being emptied, so the reveal goes with it: this runs on a shared
      // terminal facing a counter, and the next attempt should start covered again.
      setRevealed(false)
    } finally {
      setPending(false)
    }
  }

  // A form error takes precedence; otherwise show why the previous session was ended.
  const message = error ?? rejectionMessage

  return (
    /**
     * Three rows: the device's own settings, the form, and nothing else.
     *
     * The settings sit in the flow rather than pinned over the page, so they cannot land on
     * top of the card on a short window, and the form is centred in whatever is left.
     *
     * **The background is two declarations doing two different jobs.** The COLOUR is a step
     * away from the card in each palette, which is not one value: in light the tinted surface
     * sits under a white card, while in dark the card is the lighter of the two, so the page
     * drops to `--background` instead. Without that the dark card and a `bg-muted` page land
     * within a few percent of each other and the card's edge disappears.
     *
     * Over it, a wash of the brand colour at 5% fading to 2% — the page's neutrals are hue 75
     * but carry almost no chroma, so against a terracotta primary they read cool. This is a
     * gradient only in the sense that it is very slightly stronger at the top; there is no
     * focal point, nothing decorative, and the card sits on its own opaque surface above it,
     * so the separation the colour buys is not spent again here.
     */
    <div className="flex min-h-svh flex-col bg-muted/40 bg-linear-to-b from-primary/[0.05] to-primary/[0.02] px-4 py-4 dark:bg-background dark:from-primary/[0.07] dark:to-primary/[0.02]">
      <div className="flex shrink-0 items-center justify-end gap-1">
        <LanguageMenu />
        <ThemeMenu />
      </div>

      <main className="flex flex-1 items-center justify-center py-6">
        <div className="w-full max-w-sm">
          {/* `--card-spacing` rather than a `p-*` override: it is the variable the Card and
              every one of its slots already lay themselves out from, so raising it moves the
              header, the content and the gaps between them together, and the card stays a
              card of this system rather than one with custom padding bolted on. */}
          {/* `shadow-md` where an ordinary raised surface in this system gets `shadow-xs`:
              two steps up, because this card is the only thing on the page and should read as
              lifted off the wash behind it — still one of the scale's own values rather than a
              bespoke shadow. */}
          <Card className="shadow-md [--card-spacing:--spacing(6)]">
            <CardHeader className="text-center">
              {/* The product, said quietly and once. It is an eyebrow above the heading — the
                  same `text-xs … tracking-wide uppercase` this system already uses for a small
                  label over a bigger thing (see StatCard, SectionHeader) — so it identifies the
                  screen without competing with it. Text only: a mark here would be the largest
                  thing on a page whose whole job is two fields. */}
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('app.name')}
              </span>
              {/* The one thing on the page that should be read first. Two steps up from the
                  Card's own title size, which is sized for a panel heading among many. */}
              <CardTitle className="text-2xl font-semibold tracking-tight">
                {t('login.title')}
              </CardTitle>
              <CardDescription>{t('login.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(event) => void handleSubmit(event)}
                noValidate
                className="grid gap-5"
              >
                {/* Left as it was: this variant is already quiet — the card's own background
                    with destructive text and an icon, rather than a filled red band.
                    Restyling it here would also make one error in the application look
                    unlike every other one. */}
                {message && (
                  <Alert variant="destructive">
                    <AlertCircle aria-hidden="true" />
                    <AlertDescription>{t(message)}</AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-2.5">
                  <Label htmlFor="email">{t('login.email')}</Label>
                  {/* `group` + `focus-within` rather than `peer`: the icon is painted over the
                      field and so must come after it in the DOM, which is the one direction
                      `peer-*` cannot reach. The tint is the brand colour, the same one the
                      focus ring already uses — `--ring` and `--primary` are the same value in
                      this theme — so a focused field is stated twice in one colour rather than
                      two. */}
                  <div className="group relative">
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="username"
                      autoFocus
                      required
                      className="h-touch pl-10 text-base"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={pending}
                    />
                    <Mail
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground transition-colors group-focus-within:text-primary"
                    />
                  </div>
                </div>

                <div className="grid gap-2.5">
                  <Label htmlFor="password">{t('login.password')}</Label>
                  {/* The reveal sits inside the field's own box, so the row is exactly as
                      tall and as wide as the email field above it and the two still line up. */}
                  <div className="group relative">
                    <Input
                      id="password"
                      name="password"
                      type={revealed ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      className="h-touch pr-12 pl-10 text-base"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={pending}
                    />
                    <Lock
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground transition-colors group-focus-within:text-primary"
                    />
                    {/* `type="button"`, or it would submit the form on the first click.
                        `aria-pressed` rather than only a changing label, so the state is
                        announced as a state; the label says what the next press will do. */}
                    <button
                      type="button"
                      data-testid="toggle-password"
                      aria-label={t(revealed ? 'login.hidePassword' : 'login.showPassword')}
                      aria-pressed={revealed}
                      aria-controls="password"
                      disabled={pending}
                      onClick={() => setRevealed((current) => !current)}
                      className="absolute inset-y-1 end-1 flex w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
                    >
                      {revealed ? (
                        <EyeOff aria-hidden="true" className="size-4" />
                      ) : (
                        <Eye aria-hidden="true" className="size-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* The primary action, and the only button in the card. Its hover, focus ring
                    and press shift are the Button primitive's own — overriding them here
                    would make this button behave unlike every other one in the application.
                    The shadow is the one addition, and it is the whole press interaction: the
                    button rests at the system's raised elevation, lifts a step on hover and
                    goes flat when held — which, with the primitive's own `translate-y-px`,
                    makes a press look like a press rather than only a colour change.

                    `aria-busy` and the spinner say the same thing twice, once for the screen
                    and once for a screen reader; `disabled` is unchanged and is still what
                    actually prevents a second submit. */}
                <Button
                  type="submit"
                  size="lg"
                  className="mt-1 h-touch w-full text-base shadow-xs hover:shadow-sm active:shadow-none"
                  disabled={pending}
                  aria-busy={pending}
                >
                  {pending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
                  {pending ? t('login.submitting') : t('login.submit')}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Where to go if you have no account, kept out of the header so the heading and
              its one welcome line stay the whole of the hierarchy. It answers the question
              this page cannot — there is no self-service sign-up and no reset flow — by
              naming the person who can, rather than offering a link to neither. */}
          <p className="mt-4 text-center text-xs text-balance text-muted-foreground">
            {t('login.blurb')}
          </p>
        </div>
      </main>
    </div>
  )
}

/**
 * The language, before there is an account to hang it on.
 *
 * Both of these are per-DEVICE settings — the same ones the Settings page offers, reading and
 * writing the same providers — which is exactly why they belong on a screen nobody has signed
 * in to yet: a till set to Malay should say so before its first field, not after. They are
 * drawn as quiet ghost controls in the corner so they stay clearly secondary to the form.
 */
function LanguageMenu() {
  const { t, language, setLanguage } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          data-testid="login-language"
        >
          <Languages aria-hidden="true" />
          {/* The accessible name has to CONTAIN the visible text, or a voice command for what
              is on screen will not match the button. So the purpose is a hidden prefix rather
              than an aria-label that would replace the endonym entirely. */}
          <span className="sr-only">{t('account.language')}: </span>
          {/* Each language named in itself, never translated. */}
          {LANGUAGE_LABELS[language]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={language}
          onValueChange={(next) => setLanguage(next as Language)}
        >
          {LANGUAGES.map((candidate) => (
            <DropdownMenuRadioItem
              key={candidate}
              value={candidate}
              data-testid={`login-language-${candidate}`}
            >
              {LANGUAGE_LABELS[candidate]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One icon per choice, the same three the Settings page uses. */
const THEME_ICONS: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: MonitorCog,
}

function ThemeMenu() {
  const { t } = useTranslation()
  const { preference, setPreference } = useTheme()
  const Current = THEME_ICONS[preference]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          data-testid="login-theme"
          aria-label={t('account.appearance')}
        >
          <Current aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
                data-testid={`login-theme-${candidate}`}
              >
                <Icon aria-hidden="true" />
                {t(THEME_LABEL_KEYS[candidate])}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
