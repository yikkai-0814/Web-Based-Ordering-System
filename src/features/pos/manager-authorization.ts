import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc, type Firestore } from 'firebase/firestore'

import { parseUserProfile } from '@/features/auth/types'
import { authErrorMessage } from '@/lib/auth-errors'
import { authorizerServices } from '@/lib/authorizer'

/** The manager whose credentials authorised an operation, as it will be recorded. */
export interface ManagerIdentity {
  uid: string
  displayName: string
}

/**
 * One sentence for every reason an accepted sign-in is still not an authorisation: no
 * profile, deactivated, or simply not an admin. Deliberately identical in all three cases —
 * the same user-enumeration reasoning as the login messages in lib/auth-errors.ts. A staff
 * member holding a colleague's password should not learn from this screen whether that
 * colleague is an administrator.
 */
export const NOT_A_MANAGER_MESSAGE =
  'Those credentials are not allowed to authorise this. Ask an administrator.'

/**
 * Runs `action` with a manager's authority, then gives it straight back.
 *
 * This is what lets a staff member void a sale without the staff account being able to void
 * a sale. The manager signs in on the secondary app (see src/lib/authorizer.ts), `action`
 * writes using THAT session's Firestore handle so the write carries the manager's token, and
 * the session is discarded before this function returns. The till's own session is never
 * touched, elevated, or signed out.
 *
 * The admin check here is a courtesy, not the control: it exists so the person at the till
 * gets a sentence they can act on instead of a raw permission-denied. The actual control is
 * `allow create: if isAdmin()` in firestore.rules, which judges the token the write arrives
 * with and cannot be talked out of it.
 *
 * Sign-out is in a `finally`, so a thrown `action` — a rules refusal, a lost network — still
 * ends the manager's session rather than leaving borrowed authority open on a shared till.
 */
export async function withManagerAuthorization<T>(
  credentials: { email: string; password: string },
  action: (manager: ManagerIdentity, firestore: Firestore) => Promise<T>,
): Promise<T> {
  const { auth, firestore } = authorizerServices()

  try {
    let uid: string
    try {
      const signedIn = await signInWithEmailAndPassword(
        auth,
        credentials.email.trim(),
        credentials.password,
      )
      uid = signedIn.user.uid
    } catch (caught) {
      // Firebase's own codes, mapped to language a cashier can read — including
      // auth/too-many-requests, which is Firebase throttling guesses for us.
      throw new Error(authErrorMessage(caught))
    }

    const snapshot = await getDoc(doc(firestore, 'users', uid))
    if (!snapshot.exists()) throw new Error(NOT_A_MANAGER_MESSAGE)

    const profile = parseUserProfile(uid, snapshot.data())
    if (!profile || !profile.active || profile.role !== 'admin') {
      throw new Error(NOT_A_MANAGER_MESSAGE)
    }

    // The name comes from the PROFILE, not from the Auth record: firestore.rules compares
    // voidedByName against users/{uid}.displayName, so anything else would be refused.
    return await action({ uid, displayName: profile.displayName }, firestore)
  } finally {
    await signOut(auth).catch(() => undefined)
  }
}
