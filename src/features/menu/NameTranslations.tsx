import { useState } from 'react'
import { Languages } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LANGUAGE_LABELS } from '@/features/i18n/languages'
import { useTranslation } from '@/features/i18n/useTranslation'
import {
  TRANSLATABLE_LANGUAGES,
  translationCount,
  type NameTranslations,
} from '@/features/menu/localized-names'

/**
 * Naming one thing in the other languages the interface speaks.
 *
 * ONE control and ONE dialog, shared by the menu item form and the modifier option editor,
 * because an admin should have to learn this once: the English name is always in front of
 * them in the ordinary field it has always been in, and the optional translations live one
 * click behind a language button. Two components that merely looked alike would drift the
 * first time either was touched.
 *
 * **Why a dialog rather than permanent fields.** Both screens had, or would have had, one
 * input per language on display at all times — three fields for a vendor who mostly does not
 * translate anything, on a menu item form that is already long and in an option row that is
 * already Name · Adds · Cost · Actions in a grid that had collapsed once before. The fields
 * appear when they are wanted and take no room when they are not.
 *
 * **English is never edited here.** It is the canonical name, it is what every other language
 * falls back to, and it has its own field on the form behind this dialog. A second place to
 * change it would be two controls over one fact, free to disagree about which was typed last.
 *
 * Nothing is written from here either. The draft goes back to the form that opened it, and
 * reaches Firestore only when that form is saved — so Cancel really does discard.
 */

/**
 * The language button, and the count of translations behind it.
 *
 * Two shapes of the same control, because the two places it sits have different room. On the
 * menu item form it carries its words, since it stands alone under the name field where an
 * unlabelled glyph would be a guess. In an option row it is the icon and the count alone,
 * beside the two controls already in that cell, and says the rest through its accessible
 * label. The icon, the count and the behaviour are identical either way.
 */
export function TranslationsButton({
  subject,
  names,
  onOpen,
  showLabel = false,
  testId,
}: {
  /** What is being translated, for the accessible label. Already resolved, never blank. */
  subject: string
  names: NameTranslations
  onOpen: () => void
  showLabel?: boolean
  testId: string
}) {
  const { t } = useTranslation()
  const count = translationCount(names)

  /**
   * An `aria-label` REPLACES a button's contents for a screen reader, so it is set only on
   * the icon-only shape. Giving the labelled shape one would hide the words on it and read
   * out something that does not match them, which is exactly what WCAG's "label in name"
   * exists to prevent — there the visible text and the count are the accessible name.
   */
  const label = showLabel
    ? undefined
    : count === 0
      ? t('translations.open', { name: subject })
      : t(count === 1 ? 'translations.openCountOne' : 'translations.openCountOther', {
          name: subject,
          count,
        })

  return (
    <Button
      // Both screens put this inside or beside a form; a button that defaulted to `submit`
      // would save the menu item instead of opening the dialog.
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0 px-2"
      data-testid={testId}
      data-translations={count}
      aria-label={label}
      onClick={onOpen}
    >
      <Languages aria-hidden="true" />
      {showLabel && t(count === 0 ? 'translations.add' : 'translations.edit')}
      {/* Inline beside the icon rather than a corner badge: it sizes itself, so it cannot
          overlap the glyph or be clipped by the button's own box. */}
      {count > 0 && <span className="tabular-nums text-xs text-muted-foreground">{count}</span>}
    </Button>
  )
}

/**
 * The fields themselves.
 *
 * `sourceName` is the one thing the two callers differ on. An option row's own Name input is
 * a truncated cell in a four-column grid, so the dialog shows the English name back as a
 * read-only reference; the menu item form's name field is full width directly behind the
 * dialog, so repeating it there would be noise. Either way it cannot be edited from here.
 */
export function NameTranslationsDialog({
  subject,
  names,
  max,
  sourceName,
  onSave,
  onCancel,
}: {
  /** What is being translated, shown in the title. Already resolved, never blank. */
  subject: string
  names: NameTranslations
  /** The same length limit the English name is held to — ITEM_NAME_MAX or the option's. */
  max: number
  sourceName?: string
  onSave: (names: NameTranslations) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  /**
   * Seeded once and edited locally, so Cancel discards. Trimming is deliberately NOT done on
   * the way in: the admin should see what they typed, and a translation of nothing but spaces
   * is dropped when it is stored rather than silently rewritten under the cursor. See
   * `storedTranslations`.
   */
  const [draft, setDraft] = useState<NameTranslations>(names)

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle data-testid="translation-title">
            {/* The vendor's own word, inserted verbatim — never looked up. */}
            {t('translations.title', { name: subject })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('translations.hint')}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3">
          {sourceName !== undefined && (
            /* Read-only rather than disabled, so it can still be selected and copied. */
            <div className="grid gap-1.5">
              <Label htmlFor="translation-source">{LANGUAGE_LABELS.en}</Label>
              <Input
                id="translation-source"
                data-testid="translation-source"
                value={sourceName}
                readOnly
                className="bg-muted text-muted-foreground"
              />
            </div>
          )}

          {/* Rendered from the language list rather than written out twice, so a fourth
              language becomes a field here the day it is added. Each is labelled with its own
              endonym: somebody looking for 中文 is not looking for the English word
              "Chinese". */}
          {TRANSLATABLE_LANGUAGES.map((language) => (
            <div key={language} className="grid gap-1.5">
              <Label htmlFor={`translation-${language}`}>{LANGUAGE_LABELS[language]}</Label>
              <Input
                id={`translation-${language}`}
                data-testid={`translation-${language}`}
                value={draft[language] ?? ''}
                maxLength={max}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [language]: event.target.value }))
                }
              />
            </div>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel data-testid="translation-cancel">
            {t('common.cancel')}
          </AlertDialogCancel>
          <Button type="button" data-testid="translation-save" onClick={() => onSave(draft)}>
            {t('common.save')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
