import { message, MessageError } from '@/features/i18n/messages'
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore'

import { openingEntryFrom, type OpeningEntry } from '@/features/menu/cost-history'
import type { ItemNameTranslations } from '@/features/menu/item-names'
import type { OptionNameTranslations } from '@/features/menu/option-names'
import { modifierCostKey, parseModifierOptionCost } from '@/features/menu/modifier-cost'
import type { SelectionMode } from '@/features/menu/modifiers'
import { auth, db } from '@/lib/firebase'

/**
 * Every write to the menu collections lives here, so the components stay declarative and
 * there is one place to look when the shape of a document changes.
 *
 * These calls are admin-only. That is not enforced here — it is enforced by
 * firestore.rules. A staff user calling any of these gets a permission-denied error from
 * the server, which is the point: the UI hiding the buttons is convenience, the rules are
 * the boundary.
 */

export interface CategoryInput {
  name: string
  sortOrder: number
  active: boolean
}

export interface MenuItemInput {
  /** The English name. Required, and what every other language falls back to. */
  name: string
  /**
   * The translations of that name, trimmed, with blank ones left out — see
   * `storedTranslations`. Required on the way in, though it may be empty: a caller that
   * could omit it would silently wipe an item's translations on the next save.
   *
   * Written as a whole map, so the admin's two fields are the whole truth about what this
   * item is called; clearing one clears it in the document too.
   */
  names: ItemNameTranslations
  description: string
  categoryId: string
  /** Whole sen. Never a float — see src/lib/money.ts. */
  price: number
  sortOrder: number
  active: boolean
  /** Shared groups attached to this item, in the order they should be asked. */
  modifierGroupIds: string[]
}

/**
 * What the café pays, in whole sen, or `null` for "not recorded".
 *
 * `null` is now only ever an *outgoing* value. Every item written through this module
 * carries a cost, because an item without one silently turns every margin it appears in
 * into an upper bound — the Reports page has a whole warning band about exactly that. But
 * items created before the rule existed genuinely have no cost, so `previous` still has to
 * be able to say so.
 *
 * Zero remains meaningfully different from absent: zero claims the item is free to make,
 * which is a statement, where absent is the lack of one.
 */
export type CostInput = number | null

/**
 * A cost change, stated as both its new and previous value.
 *
 * `next` is a plain number: cost is mandatory, so there is no longer any way to express
 * "clear it", by accident or on purpose. `previous` stays nullable for the legacy items
 * described above, and is what lets the history journal record only real changes rather
 * than an entry every time somebody fixes a typo in an item's name.
 */
export interface CostUpdate {
  next: number
  previous: CostInput
}

/**
 * The backstop behind the form's own validation.
 *
 * The form refuses a blank or malformed cost before it gets here, and the type refuses
 * `null` at compile time — but neither survives contact with a caller written later, or
 * with `any` arriving from a test or the console. Whole sen and never negative are the same
 * two invariants the price fields are held to; see src/lib/money.ts.
 */
function requireCost(cost: number): number {
  if (typeof cost !== 'number' || !Number.isInteger(cost) || cost < 0) {
    throw new MessageError(message('validation.costRequired'))
  }
  return cost
}

/**
 * Cost lives in `menuItemCosts/{itemId}` — a separate, admin-only collection, because
 * Firestore permissions are per-document and staff must be able to read menuItems.
 * Item and cost are written together in a batch so the two can never drift apart.
 *
 * A changed cost also appends to `menuItemCostHistory`, in the same batch. That journal is
 * how margin stays computable for past sales: staff cannot read costs, so they cannot stamp
 * one onto an order they ring up, and reporting instead resolves the cost that was in force
 * at the time of the sale. Unchanged costs append nothing — a journal should record events
 * that happened.
 */
/**
 * Where one kind of cost is kept: the current value, its journal, and the fields that
 * identify what the cost is FOR.
 *
 * Menu items and modifier options are costed identically — same mandatory value, same
 * append-only journal, same opening-entry backfill — and differ only in which collections
 * they live in and how the thing being costed is named. Stating that difference as data is
 * what lets one `writeCost` serve both instead of a second copy of the journal logic
 * drifting away from the first.
 */
interface CostTarget {
  /** Holds the current value, keyed by `docId`. */
  costPath: string
  /** Append-only journal of every change. */
  historyPath: string
  /** The document id under `costPath`. */
  docId: string
  /**
   * Identifying fields written onto the CURRENT-value document, beside `cost`.
   *
   * Empty for a menu item, whose id alone says what it is a cost for and whose rule names
   * exactly `cost` and `updatedAt` — adding a redundant `itemId` would be refused, and
   * rightly: it would be the document id recorded a second time, able to disagree with
   * itself. An option's id is a composite, so its two halves are stored as well, which is
   * what lets one query fetch every cost belonging to a group.
   */
  costFields: Record<string, string>
  /** Identifying fields written onto every journal entry. A journal row has no telling id. */
  historyFields: Record<string, string>
  /** The field `resolveOpeningEntry` asks the journal about. */
  historyQueryField: string
}

const itemCostTarget = (itemId: string): CostTarget => ({
  costPath: 'menuItemCosts',
  historyPath: 'menuItemCostHistory',
  docId: itemId,
  costFields: {},
  historyFields: { itemId },
  historyQueryField: 'itemId',
})

const optionCostTarget = (groupId: string, optionId: string): CostTarget => ({
  costPath: 'modifierOptionCosts',
  historyPath: 'modifierOptionCostHistory',
  // One document per option, not per (item, option): a shared group's option costs the same
  // whichever item offers it. See src/features/menu/modifier-cost.ts.
  docId: modifierCostKey(groupId, optionId),
  costFields: { groupId, optionId },
  historyFields: { groupId, optionId },
  // Only ever used by the item path; options resolve their opening entries in bulk. See
  // resolveOptionCostChanges.
  historyQueryField: 'groupId',
})

function writeCost(
  batch: WriteBatch,
  target: CostTarget,
  cost: CostUpdate,
  opening: OpeningEntry | null = null,
): void {
  const reference = doc(db, target.costPath, target.docId)
  // Always a write, never a delete: cost is mandatory, so there is no state in which an
  // item should be left without its cost document.
  batch.set(reference, {
    ...target.costFields,
    cost: requireCost(cost.next),
    updatedAt: serverTimestamp(),
  })

  if (cost.next === cost.previous) return

  const recordedBy = auth.currentUser?.uid
  if (!recordedBy) throw new MessageError(message('validation.signInToChangeCost'))

  // Backfill the outgoing value for an item that had a cost but no journal, so this edit
  // does not erase what earlier sales already resolved to. See cost-history.ts. It goes in
  // the SAME batch as the new entry, so the journal can never gain one without the other.
  if (opening) {
    batch.set(doc(collection(db, target.historyPath)), {
      ...target.historyFields,
      cost: opening.cost,
      effectiveFrom: opening.effectiveFrom,
      recordedBy,
    })
  }

  batch.set(doc(collection(db, target.historyPath)), {
    ...target.historyFields,
    cost: cost.next,
    effectiveFrom: serverTimestamp(),
    recordedBy,
  })
}

/**
 * Looks up what the journal needs before the batch is built.
 *
 * Two reads, only on a genuine cost change: does this subject have any history at all, and
 * when was its current cost recorded. Both are cheap and happen rarely — a cost edit is an
 * admin action, not a per-sale one.
 *
 * History existence is asked by `historyQueryField`, which is `itemId` for a menu item and
 * identifies exactly one item. Modifier options deliberately do not come through here: the
 * only field that identifies a group's journal in one query is `groupId`, which would answer
 * "has this GROUP any history" rather than "has this option any", and asking per option would
 * be two reads per option on every group save. `resolveOptionCostChanges` asks both
 * questions once for the whole group instead.
 */
async function resolveOpeningEntry(
  target: CostTarget,
  cost: CostUpdate,
): Promise<OpeningEntry | null> {
  if (cost.next === cost.previous || cost.previous === null) return null

  const existing = await getDocs(
    query(
      collection(db, target.historyPath),
      where(target.historyQueryField, '==', target.historyFields[target.historyQueryField]),
      limit(1),
    ),
  )
  const costDocument = await getDoc(doc(db, target.costPath, target.docId))
  const recordedAt = costDocument.exists() ? costDocument.data().updatedAt : null

  return openingEntryFrom(
    cost.previous,
    !existing.empty,
    recordedAt instanceof Timestamp ? recordedAt.toDate() : null,
  )
}

export async function createCategory(input: CategoryInput): Promise<string> {
  const created = await addDoc(collection(db, 'categories'), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return created.id
}

export async function updateCategory(id: string, input: CategoryInput): Promise<void> {
  await updateDoc(doc(db, 'categories', id), {
    ...input,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteCategory(id: string): Promise<void> {
  await deleteDoc(doc(db, 'categories', id))
}

/** `cost` is mandatory: an item cannot be created without one. See `requireCost`. */
/**
 * Creates an item, its cost, and any groups being invented alongside it — in one batch.
 *
 * `newGroups` are definitions the admin typed on the create form and that do not exist yet.
 * They are written here rather than beforehand so that **nothing is orphaned**: a batch is
 * all-or-nothing, so a refused item cannot leave a set of groups behind that no screen would
 * ever show. Their ids are generated client-side, exactly as the item's already was, which is
 * what lets them be listed on the item in the same write that creates them.
 *
 * Order is preserved end to end: groups already attached come first, in the order the admin
 * arranged them, then the newly created ones in the order they were added.
 */
export async function createMenuItem(
  input: MenuItemInput,
  cost: number,
  newGroups: readonly ModifierGroupInput[] = [],
): Promise<string> {
  // The id is generated client-side so the item and its cost can share one, and both go in
  // a single batch.
  const itemReference = doc(collection(db, 'menuItems'))
  const batch = writeBatch(db)

  const createdGroupIds: string[] = []
  for (const group of newGroups) {
    const groupReference = doc(collection(db, 'modifierGroups'))
    batch.set(groupReference, {
      ...modifierGroupFields(group),
      // An item-specific group records its owner and is NOT listed on the item: it resolves
      // through that owner, which is also what makes it disappear with the item. A shared one
      // records no owner and is listed instead, so it can be listed by other items too.
      ...(group.shared ? {} : { itemId: itemReference.id }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    // Brand-new options, so there is nothing to read first and no opening entry to write.
    writeOptionCosts(batch, groupReference.id, group.options)
    if (group.shared) createdGroupIds.push(groupReference.id)
  }

  batch.set(itemReference, {
    ...input,
    modifierGroupIds: [...input.modifierGroupIds, ...createdGroupIds],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  // A brand-new item has no previous cost, so any value at all is a real change.
  writeCost(batch, itemCostTarget(itemReference.id), { next: cost, previous: null })
  await batch.commit()
  return itemReference.id
}

/**
 * `cost` is **required**, with no default.
 *
 * Both halves have to be stated. A default for `next` would let a caller who simply forgot
 * the argument write a cost nobody chose, and `previous` is what the history journal needs
 * in order to record only genuine changes.
 */
export async function updateMenuItem(
  id: string,
  input: MenuItemInput,
  cost: CostUpdate,
): Promise<void> {
  // Read before the batch: a batch cannot read, and the journal needs to know whether this
  // item has any history yet.
  const opening = await resolveOpeningEntry(itemCostTarget(id), cost)

  const batch = writeBatch(db)
  batch.update(doc(db, 'menuItems', id), {
    ...input,
    updatedAt: serverTimestamp(),
  })
  writeCost(batch, itemCostTarget(id), cost, opening)
  await batch.commit()
}

/**
 * Removes the item and its cost together — a stray cost document would outlive its item.
 *
 * **Only groups this item exclusively owns go with it.** A legacy group names one item in
 * `itemId` and can be offered by no other, so deleting the item leaves it unreachable and it
 * is removed — the behaviour this has always had. A SHARED group is a definition in its own
 * right: "Sugar Level" outlives any one drink, and deleting Milk Tea must not take it away
 * from Lemon Tea. Those are left alone entirely; the attachment disappears with the item
 * document that carried it, which is all that has to happen.
 *
 * A shared group that no item happens to list any more is not deleted either. It stays in the
 * reusable pool, which is the point of it being reusable, and an admin who wants it gone can
 * delete it deliberately.
 *
 * Past orders are untouched either way: their selections are snapshots and never read this
 * collection.
 *
 * Note the limit, which mirrors the one on the cost document: the rules can require that the
 * cost is gone with `existsAfter`, because there is exactly one of it. A variable number of
 * groups cannot be expressed that way, so this batch is the guarantee — deleting an item
 * straight from the Firebase console would still strand its legacy groups.
 */
export async function deleteMenuItem(id: string): Promise<void> {
  const exclusiveGroupIds = await legacyGroupIdsOwnedBy(id)

  const batch = writeBatch(db)
  batch.delete(doc(db, 'menuItems', id))
  batch.delete(doc(db, 'menuItemCosts', id))
  for (const groupId of exclusiveGroupIds) batch.delete(doc(db, 'modifierGroups', groupId))
  await batch.commit()
}

/**
 * Archives or restores an item. Archiving is the safe everyday action — it hides the item
 * from service without touching anything that references it.
 */
export async function setMenuItemActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, 'menuItems', id), { active, updatedAt: serverTimestamp() })
}

export async function setCategoryActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, 'categories', id), { active, updatedAt: serverTimestamp() })
}

/* ---------------------------------------------------------------------------
 * Menu item customisation
 *
 * Groups live in their own top-level `modifierGroups` collection, keyed to a menu item by
 * `itemId`, rather than in a subcollection under the item. The till needs to know which of
 * the whole menu's items ask a question before anything is tapped, and one collection-wide
 * subscription answers that the same way `useMenuItems` already answers what is on sale;
 * a subcollection would mean a listener per item or a collection-group index for no gain.
 *
 * Options are stored as an array inside the group. They are few, always read together, and
 * never queried on their own, so a second collection would buy nothing and would let a
 * group and its choices disagree.
 * ------------------------------------------------------------------------- */

export interface ModifierOptionInput {
  /** Stable within the group. Snapshotted onto order lines, so it must not be reused. */
  id: string
  /** The English name. Required, and what every other language falls back to. */
  name: string
  /**
   * The translations of that name, trimmed, with blank ones left out — see
   * `storedTranslations`. Required on the way in, though it may be empty: a caller that
   * could omit it would silently wipe an option's translations on the next save.
   *
   * Written as a whole map, exactly as a menu item's is, so the admin's two fields are the
   * whole truth about what this option is called; clearing one clears it in the document too.
   * English is NOT in here — it is `name` — so the option is never named twice.
   */
  names: OptionNameTranslations
  /** Whole sen. May be 0 ("No egg") and is never a float. */
  priceAdjustment: number
  /**
   * What the café pays to provide this option, in whole sen — nothing to do with what it
   * adds to the bill. An extra egg might sell for RM1.50 and cost RM0.40.
   *
   * Mandatory, exactly as a menu item's cost is, and 0 for a new option. An option with no
   * cost at all would silently turn every margin it appears in into an upper bound, which
   * is the condition the Reports coverage warning exists to surface.
   *
   * It is NOT written into the group document — see modifier-cost.ts for why that would put
   * cost in front of every staff account — so it travels here and lands in its own
   * collection.
   */
  cost: number
  active: boolean
}

export interface ModifierGroupInput {
  /**
   * Whether this definition may be offered by more than one item.
   *
   * **Shared** (the default) writes no owner and is attached by listing its id on the item,
   * so editing it changes every item that offers it. **Item-specific** records the owning
   * item on the group itself, in `itemId` — the same field the first version of this feature
   * used, because it already means exactly this: a group belonging to one item and no other.
   * Legacy groups are therefore not a separate case, they are simply item-specific groups
   * written before the choice existed, and everything that resolves, deletes or lists them
   * already works.
   *
   * Only read when a group is CREATED. Changing an existing group's sharing would move it
   * between items, so `updateModifierGroup` deliberately never writes `itemId`.
   */
  shared: boolean
  name: string
  selection: SelectionMode
  required: boolean
  sortOrder: number
  active: boolean
  options: ModifierOptionInput[]
}

/**
 * A group document is a **shared definition** and carries no item of its own. The legacy
 * `itemId` is deliberately absent from everything written here: a group written today is
 * attached by listing its id on the item, and writing an owner as well would be a second
 * record of the same fact that could disagree with the first.
 */
function modifierGroupFields(input: ModifierGroupInput) {
  return {
    name: input.name.trim(),
    selection: input.selection,
    required: input.required,
    sortOrder: input.sortOrder,
    active: input.active,
    options: input.options.map((option) => ({
      id: option.id,
      name: option.name.trim(),
      // Only the translations: English is `name`, and storing it twice would be two records
      // of one fact, free to disagree. An option nobody has translated writes `{}` and reads
      // back exactly like one written before this feature existed. See option-names.ts.
      names: option.names,
      priceAdjustment: option.priceAdjustment,
      active: option.active,
    })),
  }
}

/**
 * What each option's cost should become, and the opening entry it may need first.
 *
 * Keyed by option id, because that is what the caller has in hand.
 */
type OptionCostChanges = Map<string, { cost: CostUpdate; opening: OpeningEntry | null }>

/**
 * Reads the current option costs for one group and works out what each save has to journal.
 *
 * **Two queries for the whole group, never two per option.** Both are answered by the
 * automatic single-field index on `groupId`, and both are bounded by the size of the group
 * and by how often its costs have been edited — neither grows with trading.
 *
 * The per-option opening entry is the same rule menu items follow: an option that already
 * has a cost but no journal gets its outgoing value written first, dated from when that
 * value was actually recorded. Without it, the first edit to a long-standing option would
 * flip every earlier sale of it from costed to uncosted, because the previous figure would
 * have nowhere left to live. See cost-history.ts.
 */
async function resolveOptionCostChanges(
  groupId: string,
  options: readonly ModifierOptionInput[],
): Promise<OptionCostChanges> {
  const [costDocs, historyDocs] = await Promise.all([
    getDocs(query(collection(db, 'modifierOptionCosts'), where('groupId', '==', groupId))),
    getDocs(query(collection(db, 'modifierOptionCostHistory'), where('groupId', '==', groupId))),
  ])

  const previous = new Map<string, { cost: number | null; recordedAt: Date | null }>()
  for (const document of costDocs.docs) {
    const parsed = parseModifierOptionCost(document.id, document.data())
    if (!parsed) continue
    previous.set(parsed.optionId, {
      cost: parsed.cost,
      recordedAt: parsed.updatedAt ? parsed.updatedAt.toDate() : null,
    })
  }

  // Which options have a journal, asked per option rather than per group: a group may be
  // years old and still contain an option whose cost has never once been edited.
  const journalled = new Set<string>()
  for (const document of historyDocs.docs) {
    const optionId = document.data().optionId
    if (typeof optionId === 'string' && optionId !== '') journalled.add(optionId)
  }

  const changes: OptionCostChanges = new Map()
  for (const option of options) {
    const before = previous.get(option.id) ?? { cost: null, recordedAt: null }
    changes.set(option.id, {
      cost: { next: option.cost, previous: before.cost },
      opening: openingEntryFrom(before.cost, journalled.has(option.id), before.recordedAt),
    })
  }
  return changes
}

/**
 * Adds every option's cost document, and any journal entry it warrants, to `batch`.
 *
 * Always in the same batch as the group itself, so an option and its cost cannot drift
 * apart: a saved group can never be missing the cost of an option it just introduced, and a
 * refused save writes neither.
 *
 * **Costs are written for the options that exist now, and never deleted for ones that do
 * not.** Removing an option from a group does not remove the sales that chose it, and those
 * sales still resolve their cost through this collection. Deleting the record would flip
 * them from costed to uncosted — the very failure the opening entry above exists to
 * prevent — so a departed option simply keeps its cost, unread until a report asks about an
 * order old enough to mention it.
 */
function writeOptionCosts(
  batch: WriteBatch,
  groupId: string,
  options: readonly ModifierOptionInput[],
  changes: OptionCostChanges | null = null,
): void {
  for (const option of options) {
    const change = changes?.get(option.id)
    writeCost(
      batch,
      optionCostTarget(groupId, option.id),
      // A group being created has nothing before it, so any value is a real change.
      change?.cost ?? { next: option.cost, previous: null },
      change?.opening ?? null,
    )
  }
}

/**
 * Writes a new shared definition and attaches it to one item, in a single batch.
 *
 * Used by the editor on an existing item, which saves immediately. Both halves have to land
 * together: a group written without the attachment would be invisible to the item that was
 * just configured, and an attachment naming a group that failed to write would be a dangling
 * id. `arrayUnion` appends, so the item's existing order is untouched and the new group joins
 * the end — which is where it was added on screen.
 */
export async function createModifierGroupForItem(
  itemId: string,
  input: ModifierGroupInput,
): Promise<string> {
  const groupReference = doc(collection(db, 'modifierGroups'))
  const batch = writeBatch(db)
  batch.set(groupReference, {
    ...modifierGroupFields(input),
    ...(input.shared ? {} : { itemId }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  // The group's options are new, so every cost is an opening value with nothing before it.
  writeOptionCosts(batch, groupReference.id, input.options)
  // Only a shared definition is listed on the item. An item-specific one is reached through
  // its owner, so listing it as well would be the same fact recorded twice.
  if (input.shared) {
    batch.update(doc(db, 'menuItems', itemId), {
      modifierGroupIds: arrayUnion(groupReference.id),
      updatedAt: serverTimestamp(),
    })
  }
  await batch.commit()
  return groupReference.id
}

/**
 * Attaches a definition that already exists to another item.
 *
 * This is the whole of "reuse": one write, to the ITEM, adding an id. The shared definition
 * is not touched at all, so attaching "Sugar Level" to a fourth drink cannot disturb the
 * three that already offer it.
 */
export async function attachModifierGroup(itemId: string, groupId: string): Promise<void> {
  await updateDoc(doc(db, 'menuItems', itemId), {
    modifierGroupIds: arrayUnion(groupId),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Removes a definition from one item's list.
 *
 * **Detaching is not deleting.** The group survives untouched, still attached to every other
 * item that lists it and still offered in the pool of reusable groups. That distinction is
 * the point of splitting the definition from the association, and it is enforced here by
 * this function simply never touching the group document.
 */
export async function detachModifierGroup(itemId: string, groupId: string): Promise<void> {
  await updateDoc(doc(db, 'menuItems', itemId), {
    modifierGroupIds: arrayRemove(groupId),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Every menu item that currently offers this group — by attachment or as a legacy owner.
 *
 * Asked before a group is deleted, so the admin can be told what else is about to lose it
 * rather than finding out from a till.
 */
export async function itemsUsingGroup(groupId: string): Promise<string[]> {
  const [attached, legacy] = await Promise.all([
    getDocs(
      query(collection(db, 'menuItems'), where('modifierGroupIds', 'array-contains', groupId)),
    ),
    getDoc(doc(db, 'modifierGroups', groupId)),
  ])

  const ids = new Set(attached.docs.map((document) => document.id))
  const owner = legacy.exists() ? legacy.data().itemId : null
  if (typeof owner === 'string' && owner !== '') ids.add(owner)
  return [...ids]
}

/**
 * Replaces a group's configuration.
 *
 * **Never its sharing.** `itemId` is not written here, so an update leaves ownership exactly
 * as it was: a shared group stays shared for every item offering it, and an item-specific one
 * stays that item's. Moving a group between those states would move it between items, which
 * is not an edit.
 *
 * Editing a name, a price or an option's availability changes what the NEXT customer is
 * offered and nothing else: every order already placed carries its own snapshot of what was
 * chosen, so no receipt moves. That is the whole reason selections are copied onto the line.
 */
export async function updateModifierGroup(id: string, input: ModifierGroupInput): Promise<void> {
  // Read before the batch, because a batch cannot read: what each option's cost was, and
  // whether it has a journal yet, decides what this save has to append.
  const changes = await resolveOptionCostChanges(id, input.options)

  const batch = writeBatch(db)
  batch.update(doc(db, 'modifierGroups', id), {
    ...modifierGroupFields(input),
    updatedAt: serverTimestamp(),
  })
  writeOptionCosts(batch, id, input.options, changes)
  await batch.commit()
}

export async function setModifierGroupActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, 'modifierGroups', id), { active, updatedAt: serverTimestamp() })
}

/**
 * Removes a shared definition outright, and takes it off every item that offers it.
 *
 * Deactivating is the safe everyday action — it stops the group being offered while leaving
 * it editable — so this is for a group created by mistake. Past orders are unaffected either
 * way: every selection was snapshotted onto its order line and nothing reads this collection
 * to render a receipt.
 *
 * The detachments are in the same batch as the delete because a group is now shared: deleting
 * it while three drinks still list its id would leave three dangling references. They would
 * resolve to nothing and be skipped, so nothing would break — but the item documents would
 * quietly disagree with the catalogue, and a later group reusing that id is not worth
 * reasoning about. `itemsUsingGroup` is what the caller should have shown the admin first.
 */
/**
 * Note what is NOT removed: the options' cost documents, and their journal.
 *
 * A deleted group's options still appear on every order that chose one, and reporting
 * resolves those costs by `(groupId, optionId)` long after the definition itself has gone.
 * Deleting the costs would leave yesterday's sales suddenly uncosted, so they are left in
 * place — admin-only, tiny, and read only by a report reaching back far enough to need them.
 */
export async function deleteModifierGroup(id: string): Promise<void> {
  const usedBy = await itemsUsingGroup(id)

  const batch = writeBatch(db)
  for (const itemId of usedBy) {
    batch.update(doc(db, 'menuItems', itemId), {
      modifierGroupIds: arrayRemove(id),
      updatedAt: serverTimestamp(),
    })
  }
  batch.delete(doc(db, 'modifierGroups', id))
  await batch.commit()
}

/**
 * The legacy groups that name this item as their sole owner.
 *
 * Shared definitions are never returned — they carry no `itemId` — which is what keeps
 * `deleteMenuItem` from taking a reusable group away from the other items that offer it.
 */
async function legacyGroupIdsOwnedBy(itemId: string): Promise<string[]> {
  const found = await getDocs(
    query(collection(db, 'modifierGroups'), where('itemId', '==', itemId)),
  )
  return found.docs.map((entry) => entry.id)
}
