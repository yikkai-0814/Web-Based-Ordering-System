import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, getDocs, collection, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const ADMIN_UID = 'admin-uid'
const STAFF_UID = 'staff-uid'
const OTHER_STAFF_UID = 'other-staff-uid'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ordering-system-rules-test',
    firestore: {
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

afterEach(async () => {
  await testEnv.clearFirestore()
})

/** Writes the fixture profiles with rules bypassed, the way an admin would have. */
async function seedProfiles() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'users', ADMIN_UID), {
      uid: ADMIN_UID,
      email: 'admin@example.com',
      displayName: 'Ada Admin',
      role: 'admin',
      active: true,
      createdAt: new Date(),
    })
    await setDoc(doc(db, 'users', STAFF_UID), {
      uid: STAFF_UID,
      email: 'staff@example.com',
      displayName: 'Sam Staff',
      role: 'staff',
      active: true,
      createdAt: new Date(),
    })
    await setDoc(doc(db, 'users', OTHER_STAFF_UID), {
      uid: OTHER_STAFF_UID,
      email: 'other@example.com',
      displayName: 'Otto Other',
      role: 'staff',
      active: true,
      createdAt: new Date(),
    })
  })
}

describe('firestore rules: users', () => {
  it('denies an unauthenticated read', async () => {
    await seedProfiles()
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'users', STAFF_UID)))
  })

  it('lets a staff member read their own profile', async () => {
    await seedProfiles()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    const snapshot = await assertSucceeds(getDoc(doc(db, 'users', STAFF_UID)))
    expect(snapshot.get('role')).toBe('staff')
  })

  it("denies a staff member reading another user's profile", async () => {
    await seedProfiles()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(getDoc(doc(db, 'users', OTHER_STAFF_UID)))
  })

  it('denies a staff member listing the users collection', async () => {
    await seedProfiles()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(getDocs(collection(db, 'users')))
  })

  it('denies a staff member promoting themselves to admin', async () => {
    await seedProfiles()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(updateDoc(doc(db, 'users', STAFF_UID), { role: 'admin' }))
  })

  it('denies a deactivated staff member reactivating themselves', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', STAFF_UID), {
        uid: STAFF_UID,
        email: 'staff@example.com',
        displayName: 'Sam Staff',
        role: 'staff',
        active: false,
        createdAt: new Date(),
      })
    })
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(updateDoc(doc(db, 'users', STAFF_UID), { active: true }))
  })

  it('denies a staff member editing even a harmless field of their own profile', async () => {
    await seedProfiles()
    const db = testEnv.authenticatedContext(STAFF_UID).firestore()
    await assertFails(updateDoc(doc(db, 'users', STAFF_UID), { displayName: 'Renamed' }))
  })

  it('lets an admin read and list every profile', async () => {
    await seedProfiles()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(getDoc(doc(db, 'users', STAFF_UID)))
    const list = await assertSucceeds(getDocs(collection(db, 'users')))
    expect(list.size).toBe(3)
  })

  it('lets an admin change a staff role and deactivate an account', async () => {
    await seedProfiles()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertSucceeds(updateDoc(doc(db, 'users', STAFF_UID), { role: 'admin' }))
    await assertSucceeds(updateDoc(doc(db, 'users', OTHER_STAFF_UID), { active: false }))
  })

  it('denies a deactivated admin, so revoking access is immediate', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', ADMIN_UID), {
        uid: ADMIN_UID,
        email: 'admin@example.com',
        displayName: 'Ada Admin',
        role: 'admin',
        active: false,
        createdAt: new Date(),
      })
    })
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(getDoc(doc(db, 'users', STAFF_UID)))
  })

  it('denies a signed-in user with no profile document', async () => {
    await seedProfiles()
    const db = testEnv.authenticatedContext('ghost-uid').firestore()
    await assertFails(getDoc(doc(db, 'users', STAFF_UID)))
  })
})

describe('firestore rules: default deny', () => {
  it('denies an admin writing to a collection no rule covers yet', async () => {
    await seedProfiles()
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore()
    await assertFails(setDoc(doc(db, 'orders', 'order-1'), { total: 12.5 }))
    await assertFails(getDoc(doc(db, 'orders', 'order-1')))
  })

  it('denies an unauthenticated write anywhere', async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(setDoc(doc(db, 'anything', 'at-all'), { x: 1 }))
  })
})
