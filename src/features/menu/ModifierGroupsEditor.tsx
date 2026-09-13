import { useState } from 'react'
import { AlertCircle, Plus, Trash2 } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createModifierGroup,
  deleteModifierGroup,
  setModifierGroupActive,
  updateModifierGroup,
  type ModifierGroupInput,
  type ModifierOptionInput,
} from '@/features/menu/menu-api'
import {
  MAX_OPTIONS_PER_GROUP,
  MODIFIER_GROUP_NAME_MAX,
  MODIFIER_OPTION_NAME_MAX,
  type ModifierGroup,
  type SelectionMode,
} from '@/features/menu/modifiers'
import { useModifierGroups } from '@/features/menu/useModifierGroups'
import { CURRENCY_PREFIX, parsePriceInput, toPriceInputValue } from '@/lib/money'

const SELECT_CLASS =
  'h-touch w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'

/**
 * The customisation an admin offers for one menu item.
 *
 * Lives inside the existing item form rather than on a page of its own: a group has no
 * meaning apart from the item it belongs to, and making it a separate destination would mean
 * navigating away from the thing being configured.
 *
 * **Editing this never touches an order that has already been placed.** Every chosen option
 * is copied onto the order line at the time of sale, so renaming "Extra egg", repricing it,
 * deactivating it or deleting the whole group changes only what the next customer is
 * offered. That is the reason the snapshot exists, and it is why deleting is offered here at
 * all rather than only deactivating.
 */
export function ModifierGroupsEditor({ itemId }: { itemId: string }) {
  const { groups, loading } = useModifierGroups()
  const [editing, setEditing] = useState<ModifierGroup | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const forItem = groups
    .filter((group) => group.itemId === itemId)
    .sort((a, b) =>
      a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.name.localeCompare(b.name),
    )

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      setEditing(null)
    } catch {
      setError('That change was refused. Your account may not have permission to edit the menu.')
    }
  }

  return (
    <Card className="w-full max-w-xl" data-testid="modifier-editor">
      <CardHeader>
        <CardTitle className="text-xl">Customisation</CardTitle>
        <CardDescription>
          What staff are asked when this item is ordered. An item with no groups is added to the
          order in one tap. Changing anything here leaves past orders exactly as they were.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && forItem.length === 0 && editing === null && (
          <p className="text-sm text-muted-foreground" data-testid="modifier-empty">
            No customisation. This item is added straight to the order.
          </p>
        )}

        <ul className="space-y-2">
          {forItem.map((group) => (
            <li key={group.id} data-testid="modifier-group-row" data-group-name={group.name}>
              {editing !== 'new' && editing?.id === group.id ? (
                <GroupForm
                  itemId={itemId}
                  group={group}
                  onCancel={() => setEditing(null)}
                  onSave={(input) => run(() => updateModifierGroup(group.id, input))}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                  <div className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {group.name}
                      {!group.active && (
                        <span className="ml-2 text-xs text-muted-foreground">Inactive</span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {describeRule(group)} · {group.options.length}{' '}
                      {group.options.length === 1 ? 'option' : 'options'}
                    </span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setEditing(group)}>
                    Edit
                  </Button>
                  {/* Deactivating is the everyday action; it stops the group being offered
                      without losing the configuration. */}
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="modifier-toggle-active"
                    onClick={() => void run(() => setModifierGroupActive(group.id, !group.active))}
                  >
                    {group.active ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${group.name}`}
                    onClick={() => void run(() => deleteModifierGroup(group.id))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {editing === 'new' ? (
          <GroupForm
            itemId={itemId}
            group={null}
            onCancel={() => setEditing(null)}
            onSave={(input) => run(() => createModifierGroup(input))}
          />
        ) : (
          <Button
            variant="outline"
            className="h-touch"
            data-testid="modifier-add-group"
            onClick={() => setEditing('new')}
          >
            <Plus aria-hidden="true" />
            Add a group
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

interface DraftOption extends ModifierOptionInput {
  /** The price as typed, in ringgit, converted to sen only on save. */
  priceText: string
}

/**
 * One group being created or edited.
 *
 * Seeded once from its props and never re-synced, the same reasoning as the item form: the
 * groups are a live subscription, and syncing on every snapshot would overwrite whatever the
 * admin was halfway through typing.
 */
function GroupForm({
  itemId,
  group,
  onSave,
  onCancel,
}: {
  itemId: string
  group: ModifierGroup | null
  onSave: (input: ModifierGroupInput) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [selection, setSelection] = useState<SelectionMode>(group?.selection ?? 'single')
  const [required, setRequired] = useState(group?.required ?? true)
  const [sortOrder, setSortOrder] = useState(String(group?.sortOrder ?? 0))
  const [active, setActive] = useState(group?.active ?? true)
  const [options, setOptions] = useState<DraftOption[]>(() =>
    group
      ? group.options.map((option) => ({
          id: option.id,
          name: option.name,
          priceAdjustment: option.priceAdjustment,
          active: option.active,
          priceText: option.priceAdjustment === 0 ? '' : toPriceInputValue(option.priceAdjustment),
        }))
      : [blankOption()],
  )
  const [error, setError] = useState<string | null>(null)

  function update(index: number, patch: Partial<DraftOption>) {
    setOptions((current) =>
      current.map((option, position) => (position === index ? { ...option, ...patch } : option)),
    )
  }

  function save() {
    if (name.trim() === '') {
      setError('Give the group a name.')
      return
    }
    const parsed: ModifierOptionInput[] = []
    for (const option of options) {
      if (option.name.trim() === '') {
        setError('Every option needs a name.')
        return
      }
      // Blank means "no change to the price", which is the common case — "Normal", "No egg".
      // Money is parsed through the same helper the item price uses, so it is whole sen and
      // never a float.
      let adjustment = 0
      if (option.priceText.trim() !== '') {
        const result = parsePriceInput(option.priceText)
        if (!result.ok) {
          setError(`${option.name.trim() || 'Option'}: ${result.error}`)
          return
        }
        adjustment = result.sen
      }
      parsed.push({
        id: option.id,
        name: option.name.trim(),
        priceAdjustment: adjustment,
        active: option.active,
      })
    }
    if (parsed.length === 0) {
      setError('A group needs at least one option.')
      return
    }

    const parsedSort = Number(sortOrder)
    if (!Number.isInteger(parsedSort)) {
      setError('Sort order must be a whole number.')
      return
    }

    setError(null)
    onSave({ itemId, name, selection, required, sortOrder: parsedSort, active, options: parsed })
  }

  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid="modifier-group-form">
      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="group-name">Group name</Label>
          <Input
            id="group-name"
            value={name}
            maxLength={MODIFIER_GROUP_NAME_MAX}
            placeholder="Vegetables"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="group-sort">Sort order</Label>
          <Input
            id="group-sort"
            inputMode="numeric"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="group-selection">Selection</Label>
          <select
            id="group-selection"
            className={SELECT_CLASS}
            value={selection}
            onChange={(event) => setSelection(event.target.value as SelectionMode)}
          >
            <option value="single">One choice</option>
            <option value="multiple">Several choices</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="group-required">Required</Label>
          <select
            id="group-required"
            className={SELECT_CLASS}
            value={required ? 'yes' : 'no'}
            onChange={(event) => setRequired(event.target.value === 'yes')}
          >
            <option value="yes">Staff must choose</option>
            <option value="no">Staff may skip</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">Options</span>
        {options.map((option, index) => (
          <div key={option.id} className="flex flex-wrap items-end gap-2" data-testid="option-row">
            <div className="grid min-w-0 flex-1 gap-1.5">
              <Label htmlFor={`option-name-${option.id}`} className="text-xs">
                Name
              </Label>
              <Input
                id={`option-name-${option.id}`}
                value={option.name}
                maxLength={MODIFIER_OPTION_NAME_MAX}
                placeholder="No vegetables"
                onChange={(event) => update(index, { name: event.target.value })}
              />
            </div>
            <div className="grid w-32 gap-1.5">
              <Label htmlFor={`option-price-${option.id}`} className="text-xs">
                Adds ({CURRENCY_PREFIX})
              </Label>
              <Input
                id={`option-price-${option.id}`}
                inputMode="decimal"
                value={option.priceText}
                placeholder="0.00"
                onChange={(event) => update(index, { priceText: event.target.value })}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              data-testid="option-toggle-active"
              onClick={() => update(index, { active: !option.active })}
            >
              {option.active ? 'Active' : 'Inactive'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${option.name || 'option'}`}
              onClick={() =>
                setOptions((current) => current.filter((_, position) => position !== index))
              }
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ))}
        {options.length < MAX_OPTIONS_PER_GROUP && (
          <Button
            variant="outline"
            size="sm"
            data-testid="modifier-add-option"
            onClick={() => setOptions((current) => [...current, blankOption()])}
          >
            <Plus aria-hidden="true" />
            Add an option
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button className="h-touch" data-testid="modifier-save-group" onClick={save}>
          Save group
        </Button>
        <Button variant="outline" className="h-touch" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" className="h-touch" onClick={() => setActive(!active)}>
          {active ? 'Group active' : 'Group inactive'}
        </Button>
      </div>
    </div>
  )
}

/**
 * A fresh option, with an id generated once.
 *
 * The id is stable for the life of the option and is snapshotted onto every order line that
 * chose it, so it must never be reused for a different choice — which is why it is minted
 * here rather than derived from the name.
 */
function blankOption(): DraftOption {
  return {
    id: `opt-${Math.random().toString(36).slice(2, 10)}`,
    name: '',
    priceAdjustment: 0,
    active: true,
    priceText: '',
  }
}

function describeRule(group: ModifierGroup): string {
  if (group.selection === 'single') return group.required ? 'Exactly one' : 'At most one'
  return group.required ? 'One or more' : 'Any number'
}
