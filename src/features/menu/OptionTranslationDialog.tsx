import { useState } from 'react'

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
import { TRANSLATABLE_LANGUAGES } from '@/features/menu/localized-names'
import { MODIFIER_OPTION_NAME_MAX, type OptionNameTranslations } from '@/features/menu/option-names'

/**
 * Naming one modifier option in the other languages the interface speaks.
 *
 * **Why a dialog rather than more columns.** The option row is already Name · Adds · Cost ·
 * Actions on a card that is only just wide enough for it — the grid tracks in
 * `ModifierGroupsEditor` exist because that row had already collapsed once. Two more inputs
 * per option would take the name column back down to a few pixels, and they would be on
 * screen permanently for a vendor who mostly does not translate anything. So translating is
 * one button in the Actions area, and the fields appear only when it is pressed.
 *
 * **English is shown but not edited here.** It is the canonical name, the row's own Name
 * input is where it has always been changed, and offering a second place to change it would
 * be two controls over one field — free to disagree about which was typed last. It is
 * displayed all the same, because a translator needs to see what they are translating.
 *
 * Nothing is written from here. The draft is handed back to the group form, which saves the
 * whole group at once, so Cancel discards and a translation only reaches Firestore when the
 * admin saves the group — the same as every other thing this form edits.
 */
export function OptionTranslationDialog({
  name,
  names,
  onSave,
  onCancel,
}: {
  /** The canonical English name as it stands in the row's input this moment, untrimmed. */
  name: string
  names: OptionNameTranslations
  onSave: (names: OptionNameTranslations) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  /**
   * Seeded once and edited locally, so Cancel really does discard. Trimming is deliberately
   * NOT done on the way in: the admin should see what they typed, and a translation of
   * nothing but spaces is dropped when it is stored rather than silently rewritten as they
   * type. See `storedTranslations`.
   */
  const [draft, setDraft] = useState<OptionNameTranslations>(names)

  /** Never blank: an option being translated before it has been named still needs a title. */
  const subject = name.trim() || t('common.option')

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle data-testid="translate-option-title">
            {/* The vendor's own word, inserted verbatim — never looked up. */}
            {t('modifierAdmin.translateOption', { name: subject })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('modifierAdmin.namesHint')}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3">
          {/* Read-only rather than absent: a translator needs the source text in front of
              them, and rather than disabled so it can still be selected and copied. */}
          <div className="grid gap-1.5">
            <Label htmlFor="option-name-en">{LANGUAGE_LABELS.en}</Label>
            <Input
              id="option-name-en"
              data-testid="option-name-en"
              value={name}
              readOnly
              className="bg-muted text-muted-foreground"
            />
          </div>

          {/* Rendered from the language list rather than written out twice, so a fourth
              language becomes a field here the day it is added. Each is labelled with its own
              endonym, the same as the item form: somebody looking for 中文 is not looking for
              the English word "Chinese". */}
          {TRANSLATABLE_LANGUAGES.map((language) => (
            <div key={language} className="grid gap-1.5">
              <Label htmlFor={`option-name-${language}`}>{LANGUAGE_LABELS[language]}</Label>
              <Input
                id={`option-name-${language}`}
                data-testid={`option-name-${language}`}
                value={draft[language] ?? ''}
                maxLength={MODIFIER_OPTION_NAME_MAX}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [language]: event.target.value }))
                }
              />
            </div>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel data-testid="translate-option-cancel">
            {t('common.cancel')}
          </AlertDialogCancel>
          <Button data-testid="translate-option-save" onClick={() => onSave(draft)}>
            {t('common.save')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
