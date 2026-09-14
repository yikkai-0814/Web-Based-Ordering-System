import { message, type Message } from '@/features/i18n/messages'
import type { TranslationKey } from '@/features/i18n/translations/en'
import { useTranslation } from '@/features/i18n/useTranslation'
import { useState } from 'react'
import { AlertCircle, Plus, Trash2 } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { StatusBadge } from '@/features/pos/StatusBadge'
import type { MenuItem } from '@/features/menu/types'
import {
  attachModifierGroup,
  createModifierGroupForItem,
  deleteModifierGroup,
  detachModifierGroup,
  itemsUsingGroup,
  setModifierGroupActive,
  updateModifierGroup,
  type ModifierGroupInput,
  type ModifierOptionInput,
} from '@/features/menu/menu-api'
import {
  groupsForItem,
  MAX_OPTIONS_PER_GROUP,
  MODIFIER_GROUP_NAME_MAX,
  MODIFIER_OPTION_NAME_MAX,
  type ModifierGroup,
  type SelectionMode,
} from '@/features/menu/modifiers'
import { useModifierGroups } from '@/features/menu/useModifierGroups'
import { CURRENCY_PREFIX, parsePriceInput, toPriceInputValue } from '@/lib/money'
import { cn } from '@/lib/utils'

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
export function ModifierGroupsEditor({ item }: { item: MenuItem }) {
  const { t } = useTranslation()
  const { groups, loading } = useModifierGroups()
  const [editing, setEditing] = useState<ModifierGroup | 'new' | null>(null)
  const [error, setError] = useState<Message | null>(null)
  const [picked, setPicked] = useState('')
  const itemId = item.id

  // Resolved rather than filtered: an item's groups are the ones it lists, in the order it
  // lists them, plus any legacy group that still names it. See `groupsForItem`.
  const forItem = groupsForItem(groups, item)
  const onItem = new Set(forItem.map((group) => group.id))
  /**
   * The pool this item can reuse: shared definitions it does not already offer.
   *
   * A group with an owner is excluded — it belongs to one item and offering it here would
   * attach something another item is entitled to change or delete out from under this one.
   */
  const selectable = groups.filter((group) => group.itemId === null && !onItem.has(group.id))
  /** Attached, therefore detachable. A legacy group is not: it names this item and no other. */
  const attachedIds = new Set(item.modifierGroupIds ?? [])

  /**
   * Deleting a SHARED definition takes it away from every item that offers it, so the admin
   * is told what else is about to lose it and has to agree. `itemsUsingGroup` is asked at the
   * moment of the click rather than subscribed to: it is one read, on the rarest action here,
   * and a count that is a moment old would be worse than one that is fetched.
   *
   * A group used by this item alone — legacy or attached — deletes without a question, which
   * is the behaviour this button has always had.
   */
  async function confirmThenDelete(group: ModifierGroup) {
    setError(null)
    let elsewhere: string[] = []
    try {
      elsewhere = (await itemsUsingGroup(group.id)).filter((id) => id !== itemId)
    } catch {
      setError(message('menu.writeRefused'))
      return
    }

    if (elsewhere.length > 0) {
      const warning = t(
        elsewhere.length === 1
          ? 'modifierAdmin.sharedElsewhereOne'
          : 'modifierAdmin.sharedElsewhereOther',
        { count: elsewhere.length },
      )
      // eslint-disable-next-line no-alert
      if (
        !window.confirm(`${group.name}

${warning}

${t('modifierAdmin.detachNotDelete')}`)
      ) {
        return
      }
    }

    await run(() => deleteModifierGroup(group.id))
  }

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      setEditing(null)
    } catch {
      setError(message('menu.writeRefused'))
    }
  }

  return (
    <Card className="w-full max-w-xl" data-testid="modifier-editor">
      <CardHeader>
        <CardTitle className="text-xl">{t('modifierAdmin.title')}</CardTitle>
        <CardDescription>{t('modifierAdmin.blurb')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{t(error)}</AlertDescription>
          </Alert>
        )}

        {/* Reuse. One write, to the ITEM: the shared definition is not touched, so adding
            "Sugar Level" to a fourth drink cannot disturb the three that already offer it. */}
        {selectable.length > 0 && (
          <div className="flex gap-2">
            <NativeSelect
              aria-label={t('modifierAdmin.reuseHeading')}
              data-testid="reuse-group-select"
              value={picked}
              onChange={(event) => setPicked(event.target.value)}
            >
              <option value="">{t('modifierAdmin.reusePlaceholder')}</option>
              {selectable.map((group) => (
                /* Vendor's own word, shown exactly as typed. */
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              className="h-touch shrink-0"
              data-testid="reuse-group-add"
              disabled={picked === ''}
              onClick={() => {
                const groupId = picked
                setPicked('')
                void run(() => attachModifierGroup(itemId, groupId))
              }}
            >
              {t('modifierAdmin.reuseAdd')}
            </Button>
          </div>
        )}

        {!loading && forItem.length === 0 && editing === null && (
          <p className="text-sm text-muted-foreground" data-testid="modifier-empty">
            {t('modifierAdmin.empty')}
          </p>
        )}

        <ul className="space-y-2">
          {forItem.map((group) => (
            <li key={group.id} data-testid="modifier-group-row" data-group-name={group.name}>
              {editing !== 'new' && editing?.id === group.id ? (
                <GroupForm
                  group={group}
                  onCancel={() => setEditing(null)}
                  onSave={(input) => run(() => updateModifierGroup(group.id, input))}
                />
              ) : (
                /* Two blocks, not one flat row of seven things.
                
                   The information and the controls are separate flex children, so they wrap
                   as units: the actions drop to their own line when the card is too narrow
                   for both, instead of being interleaved with the name. `items-start` aligns
                   the controls with the header rather than centring them against a two-line
                   block. */
                <div className="flex flex-wrap items-start gap-2 rounded-lg border p-3">
                  {/* `basis-56` is what stops the name being squeezed away. As `flex-1` this
                      block had a basis of 0, so on a card this narrow the five controls took
                      the width and `truncate` ate the name — leaving the status badge looking
                      as though it sat alone above the metadata. It now asks for a readable
                      width first and the actions wrap instead. */}
                  <div className="min-w-0 grow basis-56 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {/* The vendor's own word, never translated. */}
                      <span className="min-w-0 truncate">{group.name}</span>
                      {/* Stated in both directions rather than only when something is wrong:
                          an unlabelled row previously meant "active", which is a thing you
                          have to know rather than something you can see. */}
                      <StatusBadge
                        label={t(group.active ? 'common.active' : 'common.inactive')}
                        tone={group.active ? 'good' : 'warn'}
                        testId="group-status"
                        value={group.active ? 'active' : 'inactive'}
                      />
                    </div>
                    <span className="block text-xs text-muted-foreground">
                      {t(describeRule(group))} ·{' '}
                      {t(
                        group.options.length === 1
                          ? 'modifierAdmin.optionsCountOne'
                          : 'modifierAdmin.optionsCountOther',
                        { count: group.options.length },
                      )}
                    </span>
                  </div>

                  {/* The controls, kept together so they wrap among themselves rather than
                      one at a time around the text. */}
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                      {t(
                        attachedIds.has(group.id)
                          ? 'modifierAdmin.badgeShared'
                          : 'modifierAdmin.badgeItemOnly',
                      )}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setEditing(group)}>
                      {t('common.edit')}
                    </Button>
                    {/* Detaching is not deleting: the definition survives for every other item
                      that offers it. Only an attached group can be detached — a legacy one
                      names this item and belongs to nothing else. */}
                    {attachedIds.has(group.id) && (
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="detach-group"
                        aria-label={t('modifierAdmin.detach', { name: group.name })}
                        onClick={() => void run(() => detachModifierGroup(itemId, group.id))}
                      >
                        {t('modifierAdmin.detachShort')}
                      </Button>
                    )}
                    {/* Deactivating is the everyday action; it stops the group being offered
                      without losing the configuration. */}
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="modifier-toggle-active"
                      onClick={() =>
                        void run(() => setModifierGroupActive(group.id, !group.active))
                      }
                    >
                      {t(group.active ? 'common.deactivate' : 'common.activate')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('modifierAdmin.deleteGroup', { name: group.name })}
                      onClick={() => void confirmThenDelete(group)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {editing === 'new' ? (
          <GroupForm
            group={null}
            onCancel={() => setEditing(null)}
            onSave={(input) => run(() => createModifierGroupForItem(itemId, input))}
          />
        ) : (
          <Button
            variant="outline"
            className="h-touch"
            data-testid="modifier-add-group"
            onClick={() => setEditing('new')}
          >
            <Plus aria-hidden="true" />
            {t('modifierAdmin.addGroup')}
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
export function GroupForm({
  group,
  onSave,
  onCancel,
}: {
  group: ModifierGroup | null
  onSave: (input: ModifierGroupInput) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(group?.name ?? '')
  const [selection, setSelection] = useState<SelectionMode>(group?.selection ?? 'single')
  const [required, setRequired] = useState(group?.required ?? true)
  const [sortOrder, setSortOrder] = useState(String(group?.sortOrder ?? 0))
  const [active, setActive] = useState(group?.active ?? true)
  /**
   * Shared by default, because most customisation is: "Sugar Level" is asked of every drink.
   * Offered only when CREATING — changing an existing group's sharing would move it between
   * items rather than edit it, so an existing group keeps whatever it already is.
   */
  const [shared, setShared] = useState(true)
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
  const [error, setError] = useState<Message | null>(null)

  function update(index: number, patch: Partial<DraftOption>) {
    setOptions((current) =>
      current.map((option, position) => (position === index ? { ...option, ...patch } : option)),
    )
  }

  function save() {
    if (name.trim() === '') {
      setError(message('modifierAdmin.needName'))
      return
    }
    const parsed: ModifierOptionInput[] = []
    for (const option of options) {
      if (option.name.trim() === '') {
        setError(message('modifierAdmin.needOptionName'))
        return
      }
      // Blank means "no change to the price", which is the common case — "Normal", "No egg".
      // Money is parsed through the same helper the item price uses, so it is whole sen and
      // never a float.
      let adjustment = 0
      if (option.priceText.trim() !== '') {
        const result = parsePriceInput(option.priceText)
        if (!result.ok) {
          setError(
            message('validation.optionPrefix', {
              option: option.name.trim() || t('common.option'),
              reason: t(result.error),
            }),
          )
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
      setError(message('modifierAdmin.needOption'))
      return
    }

    const parsedSort = Number(sortOrder)
    if (!Number.isInteger(parsedSort)) {
      setError(message('modifierAdmin.badSortOrder'))
      return
    }

    setError(null)
    onSave({
      // An existing group keeps its sharing: `updateModifierGroup` ignores this, and the
      // control that sets it is not shown. `true` here is inert rather than meaningful.
      shared: group ? true : shared,
      name,
      selection,
      required,
      sortOrder: parsedSort,
      active,
      options: parsed,
    })
  }

  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid="modifier-group-form">
      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{t(error)}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="group-name">{t('modifierAdmin.groupName')}</Label>
          <Input
            id="group-name"
            value={name}
            maxLength={MODIFIER_GROUP_NAME_MAX}
            placeholder={t('modifierAdmin.groupNamePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="group-sort">{t('common.sortOrder')}</Label>
          <Input
            id="group-sort"
            inputMode="numeric"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="group-selection">{t('modifierAdmin.selection')}</Label>
          <NativeSelect
            id="group-selection"
            value={selection}
            onChange={(event) => setSelection(event.target.value as SelectionMode)}
          >
            <option value="single">{t('modifierAdmin.selectionSingle')}</option>
            <option value="multiple">{t('modifierAdmin.selectionMultiple')}</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="group-required">{t('modifierAdmin.required')}</Label>
          <NativeSelect
            id="group-required"
            value={required ? 'yes' : 'no'}
            onChange={(event) => setRequired(event.target.value === 'yes')}
          >
            <option value="yes">{t('modifierAdmin.requiredYes')}</option>
            <option value="no">{t('modifierAdmin.requiredNo')}</option>
          </NativeSelect>
        </div>
      </div>

      {/* Only when creating. The consequence of choosing Shared is spelled out underneath
          rather than left to be discovered by editing one and surprising three other items. */}
      {group === null && (
        <div className="grid gap-1.5">
          <Label htmlFor="group-sharing">{t('modifierAdmin.sharing')}</Label>
          <NativeSelect
            id="group-sharing"
            data-testid="group-sharing"
            value={shared ? 'shared' : 'item'}
            onChange={(event) => setShared(event.target.value === 'shared')}
          >
            <option value="shared">{t('modifierAdmin.sharingShared')}</option>
            <option value="item">{t('modifierAdmin.sharingItemOnly')}</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground" data-testid="group-sharing-hint">
            {t(shared ? 'modifierAdmin.sharingSharedHint' : 'modifierAdmin.sharingItemOnlyHint')}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <span className="text-sm font-medium">{t('modifierAdmin.options')}</span>
        {options.map((option, index) => (
          <div key={option.id} className="flex flex-wrap items-end gap-2" data-testid="option-row">
            <div className="grid min-w-0 flex-1 gap-1.5">
              <Label htmlFor={`option-name-${option.id}`} className="text-xs">
                {t('common.name')}
              </Label>
              <Input
                id={`option-name-${option.id}`}
                value={option.name}
                maxLength={MODIFIER_OPTION_NAME_MAX}
                placeholder={t('modifierAdmin.optionPlaceholder')}
                onChange={(event) => update(index, { name: event.target.value })}
              />
            </div>
            <div className="grid w-32 gap-1.5">
              <Label htmlFor={`option-price-${option.id}`} className="text-xs">
                {t('modifierAdmin.adds', { currency: CURRENCY_PREFIX })}
              </Label>
              <Input
                id={`option-price-${option.id}`}
                inputMode="decimal"
                value={option.priceText}
                placeholder={t('modifierAdmin.addsPlaceholder')}
                onChange={(event) => update(index, { priceText: event.target.value })}
              />
            </div>
            {/* Both the indicator and the control, which is why it stays a Button and is
                not replaced by a badge: its label has always been the current state and
                clicking it flips that state. It is now drawn in the same two tones as the
                badges — green for active, red for inactive — so the state is visible at a
                glance without adding a second thing that says the same word. */}
            <Button
              variant="outline"
              size="sm"
              data-testid="option-toggle-active"
              data-status={option.active ? 'active' : 'inactive'}
              className={cn(
                'rounded-full',
                option.active
                  ? 'border-success/30 bg-success/10 text-success hover:bg-success/20 hover:text-success'
                  : 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive',
              )}
              onClick={() => update(index, { active: !option.active })}
            >
              {t(option.active ? 'common.active' : 'common.inactive')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('modifierAdmin.removeOption', {
                name: option.name || t('common.option'),
              })}
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
            {t('modifierAdmin.addOption')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button className="h-touch" data-testid="modifier-save-group" onClick={save}>
          {t('modifierAdmin.saveGroup')}
        </Button>
        <Button variant="outline" className="h-touch" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button variant="outline" className="h-touch" onClick={() => setActive(!active)}>
          {t(active ? 'modifierAdmin.groupActive' : 'modifierAdmin.groupInactive')}
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

/** The rule in a few words, as a key — the caller translates it. */
function describeRule(group: ModifierGroup): TranslationKey {
  if (group.selection === 'single') {
    return group.required ? 'modifierAdmin.ruleExactlyOne' : 'modifierAdmin.ruleAtMostOne'
  }
  return group.required ? 'modifierAdmin.ruleOneOrMore' : 'modifierAdmin.ruleAnyNumber'
}
