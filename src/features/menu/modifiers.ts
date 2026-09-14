import { message, type Message } from '@/features/i18n/messages'
import type { Timestamp } from 'firebase/firestore'

/**
 * Menu item customisation — the options a customer chooses when an item is ordered.
 *
 * Pure: no React, no Firestore, no clock, the same split as cart.ts and payments.ts. Two
 * different things live here and the distinction is the whole design:
 *
 *   * a **`ModifierGroup`** is CONFIGURATION. An admin owns it, it changes over time, and
 *     it lives in its own collection as a **shared definition**: "Sugar Level" is written
 *     once and attached to every drink that asks it. Which items offer it is recorded on the
 *     ITEM, in `modifierGroupIds` — see `groupsForItem` below for why that direction.
 *   * a **`SelectedModifier`** is a SNAPSHOT of one choice, copied onto the order line at
 *     the moment of sale, exactly as `name` and `unitPrice` already are.
 *
 * An order never dereferences configuration. That is what lets an admin rename "Extra egg",
 * reprice it, deactivate it or delete the whole group without any past receipt changing —
 * the same guarantee the menu item itself already has.
 *
 * All amounts are whole sen (see src/lib/money.ts). A price adjustment is an integer and may
 * be zero ("No egg" costs nothing), so every unit price derived here is exact.
 */

/** How many choices a group takes. Data, never a per-item special case. */
export const SELECTION_MODES = ['single', 'multiple'] as const

export type SelectionMode = (typeof SELECTION_MODES)[number]

export function isSelectionMode(value: unknown): value is SelectionMode {
  return typeof value === 'string' && (SELECTION_MODES as readonly string[]).includes(value)
}

export const MODIFIER_GROUP_NAME_MAX = 60
export const MODIFIER_OPTION_NAME_MAX = 60
/** Mirrored in firestore.rules. A group is a list on a screen, not a catalogue. */
export const MAX_OPTIONS_PER_GROUP = 30
/** Mirrored in firestore.rules, on the order line's snapshot. */
export const MAX_MODIFIERS_PER_LINE = 30

/** One choice within a group. `priceAdjustment` is whole sen and may be 0. */
export interface ModifierOption {
  id: string
  name: string
  priceAdjustment: number
  active: boolean
}

/** A set of choices — "Sugar Level", "Add-ons". Shared by every item that attaches it. */
export interface ModifierGroup {
  id: string
  /**
   * **Legacy.** Before groups were reusable, a group belonged to exactly one item and said so
   * here. Those documents are still read exactly as they were, so no existing item needed
   * migrating; `groupsForItem` resolves them alongside the new association.
   *
   * `null` on every group written since, because a shared definition has no single owner.
   * Nothing new should set it.
   */
  itemId: string | null
  name: string
  selection: SelectionMode
  /**
   * Whether the customer must answer. Combined with `selection` this covers every rule the
   * counter needs, without any of them being hard-coded per item:
   *
   * | selection | required | meaning                  |
   * | --------- | -------- | ------------------------ |
   * | single    | true     | exactly one              |
   * | single    | false    | at most one              |
   * | multiple  | true     | at least one             |
   * | multiple  | false    | any number, or none      |
   */
  required: boolean
  sortOrder: number
  active: boolean
  options: ModifierOption[]
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

/**
 * One chosen option, as recorded on an order line.
 *
 * Everything needed to render "Extra chicken +RM3.00" is here, so a receipt reads correctly
 * even after the group that produced it has been deleted. `groupName` is carried for the
 * same reason `optionName` is: it is what the customer was shown.
 */
export interface SelectedModifier {
  groupId: string
  groupName: string
  optionId: string
  optionName: string
  priceAdjustment: number
}

function parseOption(value: unknown): ModifierOption | null {
  if (typeof value !== 'object' || value === null) return null
  const { id, name, priceAdjustment, active } = value as Record<string, unknown>

  if (typeof id !== 'string' || id === '') return null
  if (typeof name !== 'string' || name.trim() === '') return null
  // A non-integer adjustment means something bypassed both the form and the rules. Refuse
  // the option rather than let a float into a money calculation.
  if (typeof priceAdjustment !== 'number' || !Number.isInteger(priceAdjustment)) return null

  return {
    id,
    name,
    priceAdjustment,
    // Absent is treated as available: the field was introduced with the group, so this only
    // matters for a document written by hand.
    active: typeof active === 'boolean' ? active : true,
  }
}

/**
 * Validates a configuration document before the app trusts it — the same contract as
 * `parseMenuItem`. A malformed group is skipped rather than rendered as a broken prompt,
 * which would be worse than not offering the customisation at all.
 */
export function parseModifierGroup(
  id: string,
  data: Record<string, unknown>,
): ModifierGroup | null {
  const { itemId, name, selection, required, sortOrder, active, options, createdAt, updatedAt } =
    data

  // Absent is the normal case now: a shared definition belongs to no single item. A present
  // one is a legacy group and still resolves for the item it names.
  if (typeof name !== 'string' || name.trim() === '') return null
  if (!isSelectionMode(selection)) return null
  if (typeof required !== 'boolean') return null
  if (typeof active !== 'boolean') return null
  if (!Array.isArray(options)) return null

  const parsedOptions: ModifierOption[] = []
  for (const option of options) {
    const parsed = parseOption(option)
    // One malformed option invalidates the group: showing the rest would silently drop a
    // choice the customer might have wanted, and a partial prompt is a wrong prompt.
    if (!parsed) return null
    parsedOptions.push(parsed)
  }

  return {
    id,
    itemId: typeof itemId === 'string' && itemId !== '' ? itemId : null,
    name,
    selection,
    required,
    sortOrder: typeof sortOrder === 'number' && Number.isFinite(sortOrder) ? sortOrder : 0,
    active,
    options: parsedOptions,
    createdAt: (createdAt as Timestamp | undefined) ?? null,
    updatedAt: (updatedAt as Timestamp | undefined) ?? null,
  }
}

/**
 * Everything needed to work out what one item asks. A `MenuItem` satisfies it.
 *
 * Taken as an object rather than an id because the association now lives on the ITEM: which
 * groups an item offers, and in what order, is the item's own business, so it is the item
 * that has to be consulted.
 */
export interface ItemCustomisation {
  id: string
  /** Shared groups attached to this item, in the order the admin arranged them. */
  modifierGroupIds: readonly string[]
}

/**
 * Every group configured for one item — shared and legacy, active or not — in the order it
 * should be shown.
 *
 * **Two sources, deliberately.** `modifierGroupIds` is the association an admin manages
 * today; `group.itemId` is how the first version of this feature recorded the same fact. Both
 * are resolved, so an item configured before groups were reusable keeps working with no
 * migration and no rewrite of its documents.
 *
 * **Order comes from the item, never from the group.** `sortOrder` lives on a shared
 * definition, so it cannot say where "Sugar Level" belongs on one drink versus another —
 * only the item's own list can. Attached groups therefore appear in array order, and legacy
 * ones after them by their own sortOrder, which is the order they have always had.
 *
 * An id naming a group that has been deleted is skipped rather than reported: detaching is a
 * write to the item and deleting is a write to the group, so a dangling id is an ordinary
 * intermediate state, not a fault. An id naming a group owned by a DIFFERENT item is skipped
 * for a stronger reason — see the guard below.
 */
export function groupsForItem(
  groups: readonly ModifierGroup[],
  item: ItemCustomisation,
): ModifierGroup[] {
  const byId = new Map(groups.map((group) => [group.id, group]))
  const resolved: ModifierGroup[] = []
  const taken = new Set<string>()

  // Defensive rather than trusting the type: `parseMenuItem` always supplies the array, but
  // this runs on the till's hot path and an item assembled some other way must not be able to
  // throw. Offering no shared group is recoverable; a counter that cannot take an order is not.
  for (const id of item.modifierGroupIds ?? []) {
    const group = byId.get(id)
    if (!group || taken.has(id)) continue
    // An owned group is reachable only through its owner. A listed id that names one
    // belonging to a different item is ignored rather than honoured: ownership is the
    // group's own statement about itself, and a list on some other item must not override
    // it — otherwise one item could offer, and edit, another item's private customisation.
    if (group.itemId !== null && group.itemId !== item.id) continue
    taken.add(id)
    resolved.push(group)
  }

  const legacy = groups
    .filter((group) => group.itemId === item.id && !taken.has(group.id))
    .sort((a, b) =>
      a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.name.localeCompare(b.name),
    )

  return [...resolved, ...legacy]
}

/**
 * The groups a customer is actually offered for one item: active groups, in the item's order,
 * each carrying only its active options.
 *
 * Deactivating rather than deleting is the everyday action here, as it is for menu items and
 * staff — a retired option must not vanish from the receipts that already mention it. A
 * group whose every option has been deactivated offers nothing, so it is dropped too.
 */
export function offeredGroupsFor(
  groups: readonly ModifierGroup[],
  item: ItemCustomisation,
): ModifierGroup[] {
  return groupsForItem(groups, item)
    .filter((group) => group.active)
    .map((group) => ({ ...group, options: group.options.filter((option) => option.active) }))
    .filter((group) => group.options.length > 0)
}

/** Whether tapping this item needs to ask anything at all. */
export function requiresCustomisation(
  groups: readonly ModifierGroup[],
  item: ItemCustomisation,
): boolean {
  return offeredGroupsFor(groups, item).length > 0
}

export type SelectionValidation = { ok: true } | { ok: false; error: Message }

/**
 * Whether a set of choices satisfies the groups offered.
 *
 * This is what disables "Add to Order" with a reason, rather than letting the counter
 * discover the problem after tapping. It is a client-side guard and not a control: nothing
 * about an order's integrity depends on it, because the price is computed from the same
 * selections that are recorded.
 */
export function validateSelections(
  groups: readonly ModifierGroup[],
  selections: readonly SelectedModifier[],
): SelectionValidation {
  for (const group of groups) {
    const chosen = selections.filter((selection) => selection.groupId === group.id)

    if (group.selection === 'single' && chosen.length > 1) {
      return { ok: false, error: message('validation.chooseOnlyOne', { group: group.name }) }
    }
    if (group.required && chosen.length === 0) {
      return { ok: false, error: message('validation.chooseGroup', { group: group.name }) }
    }
    for (const selection of chosen) {
      if (!group.options.some((option) => option.id === selection.optionId)) {
        return { ok: false, error: message('validation.optionWithdrawn', { group: group.name }) }
      }
    }
  }

  // A choice belonging to no offered group cannot be priced or explained, so it is refused
  // rather than silently dropped.
  for (const selection of selections) {
    if (!groups.some((group) => group.id === selection.groupId)) {
      return { ok: false, error: message('validation.optionUnknown') }
    }
  }

  return { ok: true }
}

/** What the chosen options add, in whole sen. Integer arithmetic, so exact. */
export function modifiersTotal(selections: readonly SelectedModifier[]): number {
  return selections.reduce((sum, selection) => sum + selection.priceAdjustment, 0)
}

/**
 * The price of one of this item as configured: the item's own price plus its adjustments.
 *
 * Clamped at zero. A set of negative adjustments larger than the item's price would
 * otherwise produce a line the till owes the customer for, which is not a discount feature.
 */
export function unitPriceWith(basePrice: number, selections: readonly SelectedModifier[]): number {
  return Math.max(0, basePrice + modifiersTotal(selections))
}

/** The snapshot to record for one chosen option. */
export function selectionOf(group: ModifierGroup, option: ModifierOption): SelectedModifier {
  return {
    groupId: group.id,
    groupName: group.name,
    optionId: option.id,
    optionName: option.name,
    priceAdjustment: option.priceAdjustment,
  }
}

/**
 * The identity of a configured line: the item, plus exactly which options were chosen.
 *
 * This is the one definition of "the same thing" in the system, and it is used twice — the
 * cart merges on it, and both the cart and the order render with it as a React key. Two of
 * the same item with different choices produce different keys and stay separate lines; two
 * with identical choices produce the same key and merge into one line of quantity two.
 *
 * Option ids are sorted so the order they were tapped in cannot affect the answer, and the
 * separators cannot occur in a Firestore id, so no two different configurations can collide.
 */
export function lineKeyOf(line: {
  menuItemId: string
  modifiers: readonly SelectedModifier[]
}): string {
  const options = line.modifiers
    .map((modifier) => modifier.optionId)
    .slice()
    .sort()
    .join(',')
  return `${line.menuItemId}|${options}`
}

/** "No vegetables · Extra chicken" — the one-line summary shown under a cart or order line. */
export function describeModifiers(selections: readonly SelectedModifier[]): string {
  return selections.map((selection) => selection.optionName).join(' · ')
}
