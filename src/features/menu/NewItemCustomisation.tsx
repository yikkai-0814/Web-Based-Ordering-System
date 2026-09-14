import { useTranslation } from '@/features/i18n/useTranslation'
import { useState } from 'react'
import { Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { GroupForm } from '@/features/menu/ModifierGroupsEditor'
import type { DraftCustomisation } from '@/features/menu/item-customisation'
import type { ModifierGroup } from '@/features/menu/modifiers'

/**
 * Customisation for an item that does not exist yet.
 *
 * **Why this is separate from `ModifierGroupsEditor`.** That editor saves every change the
 * moment it is made, which is right for an item that already exists and is how editing has
 * always worked — nothing here changes it. But a new item has no id to attach anything to,
 * which is exactly why the form used to say "save the item first". So this holds the whole
 * configuration in memory and hands it back to the form, which writes the item, its brand-new
 * groups and its attachments in **one batch**. Nothing is written until Create is pressed, so
 * a refused item cannot leave orphaned groups behind.
 *
 * The group editor itself is NOT duplicated: `GroupForm` was already a controlled component
 * that validates a draft and calls `onSave` with a `ModifierGroupInput`, never touching
 * Firestore. It is reused verbatim, which is why creating a group looks identical on both
 * screens.
 *
 * Three states are kept visually distinct, because they behave differently:
 *
 *   * **reusable** — a shared definition that already exists and can be added;
 *   * **shared** — one that has been added to this item, removable without deleting it;
 *   * **new** — one being invented here, which only comes into existence on Create.
 */
export function NewItemCustomisation({
  available,
  value,
  onChange,
  disabled,
}: {
  /** Every shared definition that exists today. Vendor-entered names, never translated. */
  available: readonly ModifierGroup[]
  value: DraftCustomisation
  onChange: (next: DraftCustomisation) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [picked, setPicked] = useState('')

  const attachedSet = new Set(value.attachedIds)
  const selectable = available.filter((group) => !attachedSet.has(group.id))
  const attached = value.attachedIds
    .map((id) => available.find((group) => group.id === id))
    .filter((group): group is ModifierGroup => group !== undefined)

  function attach(groupId: string) {
    if (groupId === '' || attachedSet.has(groupId)) return
    onChange({ ...value, attachedIds: [...value.attachedIds, groupId] })
    setPicked('')
  }

  function detach(groupId: string) {
    onChange({ ...value, attachedIds: value.attachedIds.filter((id) => id !== groupId) })
  }

  function removeDraft(index: number) {
    onChange({ ...value, drafts: value.drafts.filter((_, position) => position !== index) })
  }

  const nothingYet = attached.length === 0 && value.drafts.length === 0

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="reuse-group">{t('modifierAdmin.reuseHeading')}</Label>
        {selectable.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('modifierAdmin.reuseNone')}</p>
        ) : (
          <div className="flex gap-2">
            <NativeSelect
              id="reuse-group"
              data-testid="reuse-group-select"
              value={picked}
              onChange={(event) => setPicked(event.target.value)}
              disabled={disabled}
            >
              <option value="">{t('modifierAdmin.reusePlaceholder')}</option>
              {selectable.map((group) => (
                /* The group's name is the vendor's own word and is shown exactly as typed. */
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </NativeSelect>
            <Button
              type="button"
              variant="outline"
              className="h-touch shrink-0"
              data-testid="reuse-group-add"
              disabled={disabled || picked === ''}
              onClick={() => attach(picked)}
            >
              {t('modifierAdmin.reuseAdd')}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">{t('modifierAdmin.onThisItem')}</span>

        {nothingYet && <p className="text-sm text-muted-foreground">{t('modifierAdmin.empty')}</p>}

        <ul className="space-y-2">
          {attached.map((group) => (
            <li
              key={group.id}
              className="flex items-center gap-2 rounded-lg border p-2.5"
              data-testid="attached-group"
              data-group-id={group.id}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                {t('modifierAdmin.badgeShared')}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('modifierAdmin.detach', { name: group.name })}
                data-testid="detach-group"
                disabled={disabled}
                onClick={() => detach(group.id)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}

          {value.drafts.map((draft, index) => (
            <li
              key={`${draft.name}-${String(index)}`}
              className="flex items-center gap-2 rounded-lg border border-dashed p-2.5"
              data-testid="draft-group"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{draft.name}</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                {t('modifierAdmin.badgeNew')}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('modifierAdmin.detach', { name: draft.name })}
                data-testid="remove-draft-group"
                disabled={disabled}
                onClick={() => removeDraft(index)}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>

        {value.drafts.length > 0 && (
          <p className="text-xs text-muted-foreground">{t('modifierAdmin.draftHint')}</p>
        )}
      </div>

      {creating ? (
        <GroupForm
          group={null}
          onCancel={() => setCreating(false)}
          onSave={(input) => {
            onChange({ ...value, drafts: [...value.drafts, input] })
            setCreating(false)
          }}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-touch"
          data-testid="create-new-group"
          disabled={disabled}
          onClick={() => setCreating(true)}
        >
          <Plus aria-hidden="true" />
          {t('modifierAdmin.createNew')}
        </Button>
      )}
    </div>
  )
}
