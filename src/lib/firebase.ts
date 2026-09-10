import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

import {
  AUTH_EMULATOR_PORT,
  EMULATOR_HOST,
  FIRESTORE_EMULATOR_PORT,
  firebaseConfig,
  useEmulators,
} from '@/lib/env'

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

if (useEmulators) {
  // `disableWarnings` only silences the banner the SDK logs about credentials being
  // sent in the clear — which is the point of an emulator.
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`, {
    disableWarnings: true,
  })
  connectFirestoreEmulator(db, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT)
  console.info(
    `[firebase] Using emulators — auth :${AUTH_EMULATOR_PORT}, firestore :${FIRESTORE_EMULATOR_PORT}`,
  )
}
