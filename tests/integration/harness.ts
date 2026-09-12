/**
 * Shared plumbing for the integration suite.
 *
 * The point of this suite is that it calls the app's own write functions — `createOrder`,
 * `recordPayment`, `setFulfillment`, `writeCost` and the rest — rather than hand-building
 * equivalent documents the way the rules suites do. The rules suites answer "would the
 * database accept this shape"; this one answers "is this the shape the app actually sends".
 * Without it, an API and its rules test could drift apart and both keep passing.
 *
 * So everything here goes through the real `db` and `auth` singletons from
 * `src/lib/firebase.ts`, signed in as a real user against the Auth emulator, subject to the
 * real security rules. The only privileged step is seeding: profiles and menu rows are
 * written with rules disabled, exactly as an admin would have created them out of band.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'

import { auth, db } from '@/lib/firebase'

/** Must match VITE_FIREBASE_PROJECT_ID in vitest.config.ts — both name the same emulator data. */
export const PROJECT_ID = 'demo-ordering-system'

export const EMULATOR_HOST = '127.0.0.1'
const FIRESTORE_PORT = 8080

export interface TestAccount {
  uid: string
  email: string
  displayName: string
  role: 'admin' | 'staff'
}

/**
 * Exported because the manager-authorisation tests need to present these credentials the way
 * a manager would type them, rather than reusing an already-signed-in session.
 */
export const ACCOUNT_PASSWORD = 'emulator-password'

/**
 * Accounts are created under a fresh prefix every run and NEVER deleted.
 *
 * The obvious alternative — fixed emails, wiped between tests through the Auth emulator's
 * clear endpoint — is wrong here for two reasons. It would delete whatever accounts the
 * developer had created in their own running emulator, which is not this suite's to throw
 * away; and the Auth emulator resolves a request's project from its API key rather than
 * from the config's projectId, so the namespace this suite would be clearing is not
 * reliably the one it writes to. A unique prefix needs neither answer: nothing collides,
 * and nothing belonging to anyone else is touched. Emulator accounts do not outlive the
 * emulator, so they cost nothing to leave behind.
 */
const RUN_PREFIX = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

let testEnv: RulesTestEnvironment | null = null
let accountCounter = 0

/**
 * Loads the real rules into the emulator for this project id and keeps a privileged handle
 * for seeding. The app SDK is NOT routed through this — it talks to the emulator directly,
 * under the rules, which is the whole point.
 */
export async function startHarness(): Promise<void> {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: EMULATOR_HOST,
      port: FIRESTORE_PORT,
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    },
  })
}

export async function stopHarness(): Promise<void> {
  await signOut(auth).catch(() => undefined)
  await testEnv?.cleanup()
  testEnv = null
}

function requireEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('startHarness() has not run.')
  return testEnv
}

/**
 * Empties Firestore between tests, so no test can depend on another's leftovers.
 *
 * Only Firestore: see RUN_PREFIX for why the accounts are left alone. clearFirestore() is
 * scoped to this suite's own project id, so a developer's data under theirs is untouched.
 */
export async function resetEmulators(): Promise<void> {
  await signOut(auth).catch(() => undefined)
  await requireEnv().clearFirestore()
}

/**
 * Creates a real Auth account and the `users/{uid}` profile that authorises it.
 *
 * Both halves are needed and neither is optional: authenticating is not the same as being
 * authorised, and every rule in this system reads the profile rather than the token.
 */
export async function createAccount(
  handle: string,
  displayName: string,
  role: 'admin' | 'staff',
): Promise<TestAccount> {
  const email = `${RUN_PREFIX}-${handle}-${accountCounter++}@example.test`
  const credential = await createUserWithEmailAndPassword(auth, email, ACCOUNT_PASSWORD)
  const uid = credential.user.uid

  await requireEnv().withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', uid), {
      uid,
      email,
      displayName,
      role,
      active: true,
      createdAt: new Date(),
    })
  })

  await signOut(auth)
  return { uid, email, displayName, role }
}

/** Signs the shared app SDK in as one of the accounts. Every write afterwards is theirs. */
export async function signInAs(account: TestAccount): Promise<void> {
  await signInWithEmailAndPassword(auth, account.email, ACCOUNT_PASSWORD)
}

/** Writes fixture data with rules bypassed — the out-of-band setup an admin would have done. */
export async function seed(write: (context: { firestore: () => typeof db }) => Promise<void>) {
  await requireEnv().withSecurityRulesDisabled(async (context) => {
    await write(context as unknown as { firestore: () => typeof db })
  })
}
