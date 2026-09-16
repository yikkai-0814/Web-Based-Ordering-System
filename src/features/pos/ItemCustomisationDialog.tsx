import { useMemo, useState } from 'react'

import { useTranslation } from '@/features/i18n/useTranslation'
import { getLocalizedMenuItemName } from '@/features/menu/item-names'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  selectionOf,
  unitPriceWith,
  validateSelections,
  type ModifierGroup,
  type ModifierOption,
  type SelectedModifier,
} from '@/features/menu/modifiers'
import type { MenuItem } from '@/features/menu/types'
import type { TranslationKey } from '@/features/i18n/translations/en'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Asks how the customer wants an item made, before it reaches the order.
 *
 * Opened only for items that actually offer a choice — a plain item is still one tap, which
 * is what keeps a busy counter fast. See `requiresCustomisation`.
 *
 * The running price is the point of the screen: a counter reads the total back to the
 * customer, so the figure has to be the same one that will appear on the order, computed the
 * same way (`unitPriceWith`) rather than re-added here.
 */
export function ItemCustomisationDialog({
  item,
  groups,
  onAdd,
  onCancel,
}: {
  item: MenuItem
  /** Already narrowed to the active groups and options offered — see `offeredGroupsFor`. */
  groups: readonly ModifierGroup[]
  onAdd: (selections: SelectedModifier[]) => void
  onCancel: () => void
}) {
  const { t, language } = useTranslation()
  const [chosen, setChosen] = useState<SelectedModifier[]>(() => defaultSelections(groups))

  const validation = useMemo(() => validateSelections(groups, chosen), [groups, chosen])
  const unitPrice = unitPriceWith(item.price, chosen)

  function toggle(group: ModifierGroup, option: ModifierOption) {
    setChosen((current) => {
      const already = current.some((entry) => entry.optionId === option.id)
      const withoutOption = current.filter((entry) => entry.optionId !== option.id)

      if (group.selection === 'single') {
        // One answer per group: choosing replaces whatever was chosen before. Tapping the
        // chosen one again clears it, which is the only way to skip an optional group.
        const withoutGroup = withoutOption.filter((entry) => entry.groupId !== group.id)
        return already ? withoutGroup : [...withoutGroup, selectionOf(group, option)]
      }

      return already ? withoutOption : [...current, selectionOf(group, option)]
    })
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle data-testid="customise-title">
            {getLocalizedMenuItemName(item, language)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('modifier.chooseHow', { price: formatMoney(item.price) })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          {groups.map((group) => (
            <fieldset key={group.id} className="space-y-2" data-testid="modifier-group">
              <legend className="flex w-full items-baseline gap-2 text-sm font-semibold">
                {group.name}
                <span className="text-xs font-normal text-muted-foreground">
                  {t(ruleKeyOf(group))}
                </span>
              </legend>

              <div className="grid gap-2 sm:grid-cols-2">
                {group.options.map((option) => {
                  const selected = chosen.some((entry) => entry.optionId === option.id)
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role={group.selection === 'single' ? 'radio' : 'checkbox'}
                      aria-checked={selected}
                      data-testid="modifier-option"
                      data-option-id={option.id}
                      data-selected={selected ? 'true' : 'false'}
                      onClick={() => toggle(group, option)}
                      className={cn(
                        'flex min-h-touch items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                        'hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                        selected
                          ? 'border-primary bg-primary/[0.08] font-medium'
                          : 'bg-card text-foreground',
                      )}
                    >
                      <span className="min-w-0 truncate">{option.name}</span>
                      {option.priceAdjustment !== 0 && (
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {option.priceAdjustment > 0 ? '+' : '−'}
                          {formatMoney(Math.abs(option.priceAdjustment))}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="flex items-baseline justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">{t('common.price')}</span>
          <span className="text-lg font-semibold tabular-nums" data-testid="customise-price">
            {formatMoney(unitPrice)}
          </span>
        </div>

        {/* The reason, not just a dead button: a counter should not have to work out which
            group it has not answered. */}
        {!validation.ok && (
          <p className="text-sm text-destructive" data-testid="customise-error">
            {t(validation.error)}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} data-testid="customise-cancel">
            {t('common.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!validation.ok}
            data-testid="customise-add"
            onClick={() => validation.ok && onAdd(chosen)}
          >
            {t('modifier.addToOrder')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * What a group starts on.
 *
 * A required single-choice group is pre-set to its first option — "Normal" in every example
 * the vendor gave — so the common case is open-and-add rather than open-and-tap-everything.
 * Nothing else is pre-chosen: an optional group left alone means the customer did not ask
 * for anything, and a multi-select cannot have a sensible default.
 */
function defaultSelections(groups: readonly ModifierGroup[]): SelectedModifier[] {
  const defaults: SelectedModifier[] = []
  for (const group of groups) {
    const first = group.options[0]
    if (group.required && group.selection === 'single' && first) {
      defaults.push(selectionOf(group, first))
    }
  }
  return defaults
}

/** Which sentence describes this group's rule. A key, so the prompt follows the language. */
function ruleKeyOf(group: ModifierGroup): TranslationKey {
  if (group.selection === 'single') {
    return group.required ? 'modifier.ruleChooseOne' : 'modifier.ruleChooseOneOptional'
  }
  return group.required ? 'modifier.ruleChooseSeveral' : 'modifier.ruleOptional'
}
