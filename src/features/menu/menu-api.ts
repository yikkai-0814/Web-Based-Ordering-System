import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore'

import { db } from '@/lib/firebase'

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
 * Cost lives in `menuItemCosts/{itemId}` — a separate, admin-only collection, because
 * Firestore permissions are per-document and staff must be able to read menuItems.
 * Item and cost are written together in a batch so the two can never drift apart.
 */
function writeCost(batch: WriteBatch, itemId: string, cost: CostInput): void {
  const reference = doc(db, 'menuItemCosts', itemId)
  if (cost === null) {
    // Deleting an absent document is a no-op, so this is safe when none was recorded.
    batch.delete(reference)
  } else {
    batch.set(reference, { cost, updatedAt: serverTimestamp() })
  }
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

export async function createMenuItem(
  input: MenuItemInput,
  cost: CostInput = null,
): Promise<string> {
  // The id is generated client-side so the item and its cost can share one, and both go in
  // a single batch.
  const itemReference = doc(collection(db, 'menuItems'))
  const batch = writeBatch(db)
  batch.set(itemReference, {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  writeCost(batch, itemReference.id, cost)
  await batch.commit()
  return itemReference.id
}

/**
 * `cost` is **required**, with no default.
 *
 * `null` clears a recorded cost, so a default would mean that any caller who simply forgot
 * the argument would silently delete cost data. Forcing every call site to state its
 * intent — a number to set it, `null` to clear it — makes that impossible to do by
 * accident.
 */
export async function updateMenuItem(
  id: string,
  input: MenuItemInput,
  cost: CostInput,
): Promise<void> {
  const batch = writeBatch(db)
  batch.update(doc(db, 'menuItems', id), {
    ...input,
    updatedAt: serverTimestamp(),
  })
  writeCost(batch, id, cost)
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
