import { doc, updateDoc } from 'firebase/firestore'

import { db } from '@/lib/firebase'

/**
 * The only write a person makes to their own `users/{uid}` document.
 *
 * Deliberately one field. firestore.rules allows a self-update only when the change set is
 * exactly `['displayName']`, so sending anything else — an `updatedAt` stamp included —
 * would be refused outright. There is no second timestamp to keep either: the profile
 * already records `createdAt`, and when a name last changed is not something this system
 * asks. See the users block in firestore.rules.
 *
 * Admin writes to other people's profiles are a different job and do not live here.
 */
export async function updateDisplayName(uid: string, displayName: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { displayName })
}
