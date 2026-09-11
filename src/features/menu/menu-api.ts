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
 * Null is meaningfully different from `0`: zero would claim the item is free to make,
 * which would quietly poison any margin figure the reporting phase later derives. An
 * unrecorded cost is stored as no document at all.
 */
export type CostInput = number | null

/**
 * A cost change, stated as both its new and previous value.
 *
 * Both halves are required. `next` alone would make omitting it silently delete a recorded
 * cost, and `previous` is what lets the history journal record only real changes rather
 * than an entry every time somebody fixes a typo in an item's name.
 */
export interface CostUpdate {
  next: CostInput
  previous: CostInput
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
  if (cost.next === null) {
    // Deleting an absent document is a no-op, so this is safe when none was recorded.
    batch.delete(reference)
  } else {
    batch.set(reference, { cost: cost.next, updatedAt: serverTimestamp() })
  }

  if (cost.next === cost.previous) return

  const recordedBy = auth.currentUser?.uid
  if (!recordedBy) throw new Error('You must be signed in to change a cost.')

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

export async function createMenuItem(input: MenuItemInput, cost: CostInput): Promise<string> {
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
 * `next: null` clears a recorded cost, so a default would mean that any caller who simply
 * forgot the argument would silently delete cost data. Forcing every call site to state
 * both the new and previous value makes that impossible to do by accident, and gives the
 * history journal what it needs to record only genuine changes.
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
  const batch = writeBatch(db)
  batch.delete(doc(db, 'menuItems', id))
  batch.delete(doc(db, 'menuItemCosts', id))
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
