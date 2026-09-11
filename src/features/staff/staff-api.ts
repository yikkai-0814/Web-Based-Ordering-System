import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'

import { db } from '@/lib/firebase'

/**
 * Writes to the staff roster. Admin-only — enforced by firestore.rules, not here.
 *
 * **There is no delete.** Past orders name these people, and a record history points at
 * should not be removable by accident. Retiring someone is `setStaffActive(id, false)`,
 * which hides them from the till while leaving every order they rang up intact.
 */

export async function createStaffMember(name: string): Promise<string> {
  const created = await addDoc(collection(db, 'staffMembers'), {
    name,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return created.id
}

/**
 * Renames a staff member.
 *
 * Past orders keep the name they were rung up under: the order stores a snapshot, orders
 * are immutable, and the rules verify at write time that a new order's `staffName` matches
 * the member's current name. So a rename affects future sales only.
 */
export async function renameStaffMember(id: string, name: string): Promise<void> {
  await updateDoc(doc(db, 'staffMembers', id), { name, updatedAt: serverTimestamp() })
}

export async function setStaffActive(id: string, active: boolean): Promise<void> {
  await updateDoc(doc(db, 'staffMembers', id), { active, updatedAt: serverTimestamp() })
}
