import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, MonitorCog, Moon, Sun } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Panel } from '@/components/data/Panel'
import { validateDisplayName, DISPLAY_NAME_MAX } from '@/features/auth/types'
import { updateDisplayName } from '@/features/auth/profile-api'
import { useAuth } from '@/features/auth/useAuth'
import { message, type Message } from '@/features/i18n/messages'
import { LANGUAGE_LABELS, LANGUAGES, type Language } from '@/features/i18n/languages'
import { useTranslation } from '@/features/i18n/useTranslation'
import { THEME_LABEL_KEYS, THEMES, type ThemePreference } from '@/features/theme/theme'
import { useTheme } from '@/features/theme/useTheme'
import { cn } from '@/lib/utils'

/**
 * Everything about this session that is a preference rather than a task.
 *
 * It exists because these controls had grown into the account dropdown, which is the wrong
 * home for them: a dropdown is for navigating and signing out, it cannot hold an editable
 * field, and two radio groups inside it made the one action people actually open it for —
 * signing out — the thing furthest down the list. Here each concern is a panel with room to
 * explain itself.
 *
 * Nothing here owns any state. The theme and the language still live in their own providers
 * and are read through the same hooks every other screen uses, so a change made here reaches
 * the whole app the moment it is made rather than on a save. The display name is the one
 * thing that is written, and it is written to Firestore — where the live profile
 * subscription in AuthProvider picks it up and updates the top bar without this page telling
 * it to.
 */
export function SettingsPage() {
  const { t } = useTranslation()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t('nav.settings')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('settings.blurb')}</p>
      </header>

      <AccountPanel />
      <AppearancePanel />
      <LanguagePanel />
    </div>
  )
}

/**
 * The display name — the one thing about an account its owner may change.
 *
 * Deliberately just the one field. The email was here too, read-only, on the reasoning that
 * somebody wanting to change it needs to know who to ask; in practice it was a box that
 * could not be used, taking up half the card next to the field that could. The address is
 * still visible where it is actually useful — in the account menu, under the name.
 */
function AccountPanel() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const [name, setName] = useState(profile?.displayName ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Message | null>(null)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The confirmation is a state with a lifetime, so it has to be cleaned up: without this a
  // timer from a save could fire after the page had gone and set state on nothing.
  useEffect(() => () => void (savedTimer.current && clearTimeout(savedTimer.current)), [])

  if (!profile) return null

  const trimmed = name.trim()
  const unchanged = trimmed === profile.displayName

  async function handleSave() {
    if (!profile) return
    const result = validateDisplayName(name)
    if (!result.ok) {
      setError(result.error)
      return
    }

    setError(null)
    setPending(true)
    try {
      await updateDisplayName(profile.uid, result.name)
      // Reflect the trim, so the field shows exactly what was stored.
      setName(result.name)
      setSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 2500)
    } catch {
      // A rules refusal is the likely cause and it arrives as an opaque permission error,
      // so it is reported as what it means rather than as what it said.
      setError(message('settings.saveFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Panel
      tone="raised"
      title={t('settings.account')}
      description={t('settings.accountBlurb')}
      data-testid="settings-account"
    >
      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{t(error)}</AlertDescription>
        </Alert>
      )}

      {/* One field, so it is capped rather than stretched: a name is a few words, and an
          input running the full width of the card invites the eye to expect a paragraph.
          The button sits directly beneath it, inside the same column. */}
      <div className="grid max-w-sm gap-4">
        <div className="grid gap-2">
          <Label htmlFor="display-name">{t('settings.displayName')}</Label>
          <Input
            id="display-name"
            className="h-touch text-base"
            maxLength={DISPLAY_NAME_MAX}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
              setSaved(false)
            }}
            disabled={pending}
            data-testid="display-name"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="lg"
            className="h-touch text-base"
            disabled={pending || unchanged}
            onClick={() => void handleSave()}
            data-testid="save-display-name"
          >
            {t(pending ? 'common.saving' : 'common.save')}
          </Button>
          {/* Confirmation where the action was, not in a corner of the screen: this is one
              field and one button, and a toast would be a second place to look. */}
          {saved && (
            <span
              className="inline-flex items-center gap-1.5 text-sm font-medium text-success"
              role="status"
              data-testid="display-name-saved"
            >
              <Check className="size-4" aria-hidden="true" />
              {t('settings.saved')}
            </span>
          )}
        </div>
      </div>
    </Panel>
  )
}

/** One icon per choice, so the tiles are scannable without reading every label. */
const THEME_ICONS: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: MonitorCog,
}

/**
 * How each choice actually looks, in miniature.
 *
 * A swatch rather than a word: "System" tells somebody nothing about what they will get, and
 * the preview is the fastest way to say it. The tiles are painted with fixed light and dark
 * values instead of the theme tokens, because a preview that followed the current theme
 * would show all three options looking identical — which is the one thing it must not do.
 */
const THEME_PREVIEW: Record<ThemePreference, string> = {
  light: 'bg-white',
  dark: 'bg-neutral-900',
  system: 'bg-gradient-to-br from-white from-45% to-neutral-900 to-55%',
}

function AppearancePanel() {
  const { t } = useTranslation()
  const { preference, resolved, setPreference } = useTheme()

  return (
    <Panel
      tone="raised"
      title={t('account.appearance')}
      description={t('settings.appearanceBlurb')}
      action={<DeviceOnlyBadge />}
      data-testid="settings-appearance"
    >
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        role="radiogroup"
        aria-label={t('account.appearance')}
      >
        {THEMES.map((candidate) => {
          const Icon = THEME_ICONS[candidate]
          const active = preference === candidate
          return (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`theme-${candidate}`}
              onClick={() => setPreference(candidate)}
              className={cn(
                'group flex flex-col gap-3 rounded-xl border p-3 text-left transition-colors',
                'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                active
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/25'
                  : 'hover:border-primary/30 hover:bg-muted/40',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-16 items-end gap-1 overflow-hidden rounded-lg border p-2',
                  THEME_PREVIEW[candidate],
                )}
              >
                <span className="h-2 w-8 rounded-full bg-neutral-400/70" />
                <span className="h-2 w-4 rounded-full bg-neutral-400/40" />
              </span>
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {t(THEME_LABEL_KEYS[candidate])}
                {/* What "System" currently resolves to, so the choice is not a mystery. */}
                {candidate === 'system' && (
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {t(resolved === 'dark' ? 'theme.dark' : 'theme.light')}
                  </span>
                )}
                {active && candidate !== 'system' && (
                  <Check className="ml-auto size-4 text-primary" aria-hidden="true" />
                )}
              </span>
            </button>
          )
        })}
      </div>
    </Panel>
  )
}

/**
 * The language, as a segmented control.
 *
 * Each language is named in itself and never translated: somebody hunting for 中文 is not
 * looking for the English word "Chinese", and a menu of endonyms is readable whatever the
 * interface happens to be set to at the time.
 */
function LanguagePanel() {
  const { t, language, setLanguage } = useTranslation()

  return (
    <Panel
      tone="raised"
      title={t('account.language')}
      description={t('settings.languageBlurb')}
      action={<DeviceOnlyBadge />}
      data-testid="settings-language"
    >
      <div
        className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1"
        role="radiogroup"
        aria-label={t('account.language')}
      >
        {LANGUAGES.map((candidate) => {
          const active = language === candidate
          return (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`language-${candidate}`}
              onClick={() => setLanguage(candidate as Language)}
              className={cn(
                'h-touch flex-1 rounded-md px-4 text-base font-medium transition-colors',
                'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                active
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {LANGUAGE_LABELS[candidate]}
            </button>
          )
        })}
      </div>
    </Panel>
  )
}

/** Says out loud that these two are per-device, not per-account — the usual assumption. */
function DeviceOnlyBadge() {
  const { t } = useTranslation()
  return (
    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      {t('settings.thisDeviceOnly')}
    </span>
  )
}
