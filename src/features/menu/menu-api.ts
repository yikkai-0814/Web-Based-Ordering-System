import { message, MessageError } from '@/features/i18n/messages'
import {
  addDoc,
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
  name: string
  description: string
  categoryId: string
  /** Whole sen. Never a float — see src/lib/money.ts. */
  price: number
  sortOrder: number
  active: boolean
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
function writeCost(
  batch: WriteBatch,
  itemId: string,
  cost: CostUpdate,
  opening: OpeningEntry | null = null,
): void {
  const reference = doc(db, 'menuItemCosts', itemId)
  // Always a write, never a delete: cost is mandatory, so there is no state in which an
  // item should be left without its cost document.
  batch.set(reference, { cost: requireCost(cost.next), updatedAt: serverTimestamp() })

  if (cost.next === cost.previous) return

  const recordedBy = auth.currentUser?.uid
  if (!recordedBy) throw new MessageError(message('validation.signInToChangeCost'))

  // Backfill the outgoing value for an item that had a cost but no journal, so this edit
  // does not erase what earlier sales already resolved to. See cost-history.ts. It goes in
  // the SAME batch as the new entry, so the journal can never gain one without the other.
  if (opening) {
    batch.set(doc(collection(db, 'menuItemCostHistory')), {
      itemId,
      cost: opening.cost,
      effectiveFrom: opening.effectiveFrom,
      recordedBy,
    })
  }

  batch.set(doc(collection(db, 'menuItemCostHistory')), {
    itemId,
    cost: cost.next,
    effectiveFrom: serverTimestamp(),
    recordedBy,
  })
}

/**
 * Looks up what the journal needs before the batch is built.
 *
 * Two reads, only on a genuine cost change: does this item have any history at all, and
 * when was its current cost recorded. Both are cheap and happen rarely — a cost edit is an
 * admin action, not a per-sale one.
 */
async function resolveOpeningEntry(itemId: string, cost: CostUpdate): Promise<OpeningEntry | null> {
  if (cost.next === cost.previous || cost.previous === null) return null

  const existing = await getDocs(
    query(collection(db, 'menuItemCostHistory'), where('itemId', '==', itemId), limit(1)),
  )
  const costDocument = await getDoc(doc(db, 'menuItemCosts', itemId))
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
export async function createMenuItem(input: MenuItemInput, cost: number): Promise<string> {
  // The id is generated client-side so the item and its cost can share one, and both go in
  // a single batch.
  const itemReference = doc(collection(db, 'menuItems'))
  const batch = writeBatch(db)
  batch.set(itemReference, {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  // A brand-new item has no previous cost, so any value at all is a real change.
  writeCost(batch, itemReference.id, { next: cost, previous: null })
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
  const opening = await resolveOpeningEntry(id, cost)

  const batch = writeBatch(db)
  batch.update(doc(db, 'menuItems', id), {
    ...input,
    updatedAt: serverTimestamp(),
  })
  writeCost(batch, id, cost, opening)
  await batch.commit()
}

/** Removes the item and its cost together — a stray cost document would outlive its item. */
export async function deleteMenuItem(id: string): Promise<void> {
  // Its customisation goes with it. Nothing would ever show an orphaned group again — it is
  // keyed to an item that no longer exists — and leaving one behind would be a document the
  // admin can neither see nor remove. Past orders are untouched: their selections are
  // snapshots and never read this collection.
  //
  // Note the limit, which mirrors the one on the cost document: the rules can require that
  // the cost is gone with `existsAfter`, because there is exactly one of it. A variable
  // number of groups cannot be expressed that way, so this batch is the guarantee — deleting
  // an item straight from the Firebase console would still strand its groups.
  const groupIds = await modifierGroupIdsFor(id)

  const batch = writeBatch(db)
  batch.delete(doc(db, 'menuItems', id))
  batch.delete(doc(db, 'menuItemCosts', id))
  for (const groupId of groupIds) batch.delete(doc(db, 'modifierGroups', groupId))
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
  name: string
  /** Whole sen. May be 0 ("No egg") and is never a float. */
  priceAdjustment: number
  active: boolean
}

export interface ModifierGroupInput {
  itemId: string
  name: string
  selection: SelectionMode
  required: boolean
  sortOrder: number
  active: boolean
  options: ModifierOptionInput[]
}

function modifierGroupFields(input: ModifierGroupInput) {
  return {
    itemId: input.itemId,
    name: input.name.trim(),
    selection: input.selection,
    required: input.required,
    sortOrder: input.sortOrder,
    active: input.active,
    options: input.options.map((option) => ({
      id: option.id,
      name: option.name.trim(),
      priceAdjustment: option.priceAdjustment,
      active: option.active,
    })),
  }
}

export async function createModifierGroup(input: ModifierGroupInput): Promise<string> {
  const created = await addDoc(collection(db, 'modifierGroups'), {
    ...modifierGroupFields(input),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return created.id
}

/**
 * Replaces a group's configuration.
 *
 * Editing a name, a price or an option's availability changes what the NEXT customer is
 * offered and nothing else: every order already placed carries its own snapshot of what was
 * chosen, so no receipt moves. That is the whole reason selections are copied onto the line.
 */
export async function updateModifierGroup(id: string, input: ModifierGroupInput): Promise<void> {
  await updateDoc(doc(db, 'modifierGroups', id), {
    ...modifierGroupFields(input),
    updatedAt: serverTimestamp(),
  })
}

export async function setModifierGroupActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, 'modifierGroups', id), { active, updatedAt: serverTimestamp() })
}

/**
 * Removes a group outright.
 *
 * Deactivating is the safe everyday action — it stops the group being offered while leaving
 * it editable — so this is offered only for a group created by mistake. Past orders are
 * unaffected either way.
 */
export async function deleteModifierGroup(id: string): Promise<void> {
  await deleteDoc(doc(db, 'modifierGroups', id))
}

/** Every group configured for one item, including inactive ones. Admin screens only. */
async function modifierGroupIdsFor(itemId: string): Promise<string[]> {
  const found = await getDocs(
    query(collection(db, 'modifierGroups'), where('itemId', '==', itemId)),
  )
  return found.docs.map((entry) => entry.id)
}
