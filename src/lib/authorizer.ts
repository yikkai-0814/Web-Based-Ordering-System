import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, inMemoryPersistence, initializeAuth, type Auth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'

import {
  AUTH_EMULATOR_PORT,
  EMULATOR_HOST,
  FIRESTORE_EMULATOR_PORT,
  firebaseConfig,
  useEmulators,
} from '@/lib/env'

/**
 * A SECOND Firebase app, used only to borrow a manager's authority for one write.
 *
 * The till signs in once, as itself, and stays signed in all shift — that session is in
 * `src/lib/firebase.ts` and this file never touches it. When a staff member needs a manager
 * to authorise something, the manager's credentials are used here instead, on an app with
 * its own independent Auth state. Two consequences make this the whole security model:
 *
 *   * the write is made with the MANAGER's token, so `allow create: if isAdmin()` in
 *     firestore.rules judges it without needing to change and without the till's account
 *     ever being granted anything;
 *   * the till's session is untouched, so nobody is signed out mid-shift and the manager's
 *     authority ends the moment the operation does.
 *
 * `inMemoryPersistence` is the third: the manager's session is never written to
 * localStorage or IndexedDB, so it cannot survive a refresh, cannot be picked up by another
 * tab, and leaves nothing behind on a shared till if the sign-out is somehow missed.
 *
 * Created lazily. A till that never voids anything never builds this at all.
 */

const APP_NAME = 'authorizer'

export interface AuthorizerServices {
  auth: Auth
  firestore: Firestore
}

let services: AuthorizerServices | null = null

function authorizerApp(): FirebaseApp {
  // getApps() rather than a bare initializeApp: a dev-server hot reload re-runs this module
  // while the previous app object is still registered, and initializing twice under the same
  // name throws.
  const existing = getApps().find((app) => app.name === APP_NAME)
  return existing ? getApp(APP_NAME) : initializeApp(firebaseConfig, APP_NAME)
}

export function authorizerServices(): AuthorizerServices {
  if (services) return services

  const app = authorizerApp()
  // initializeAuth rather than getAuth + setPersistence: this sets the persistence at
  // construction, so there is no window in which the manager's session could be persisted.
  const auth = initializeAuth(app, { persistence: inMemoryPersistence })
  const firestore = getFirestore(app)

  if (useEmulators) {
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`, {
      disableWarnings: true,
    })
    connectFirestoreEmulator(firestore, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT)
  }

  services = { auth, firestore }
  return services
}
