/**
 * Reads and validates the Firebase configuration from `import.meta.env`.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time, so a missing variable does not
 * surface as `undefined` at the point of use — it surfaces much later as an opaque
 * Firebase error such as `auth/invalid-api-key`. Checking every key once, here, turns
 * that into a single readable startup failure that names exactly what is missing.
 */

const REQUIRED_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const

type RequiredKey = (typeof REQUIRED_KEYS)[number]

function readRequired(): Record<RequiredKey, string> {
  // Written out rather than looked up dynamically: Vite only replaces static
  // `import.meta.env.VITE_X` references, not `import.meta.env[key]`.
  const raw: Record<RequiredKey, string | undefined> = {
    VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
  }

  const missing = REQUIRED_KEYS.filter((key) => {
    const value = raw[key]
    return typeof value !== 'string' || value.trim() === ''
  })

  if (missing.length > 0) {
    throw new Error(
      [
        'Firebase configuration is incomplete.',
        '',
        `Missing or empty: ${missing.join(', ')}`,
        '',
        'Copy .env.example to .env.local and fill in the values from your Firebase project',
        '(Firebase Console -> Project settings -> General -> Your apps -> Web app),',
        'then restart the dev server.',
      ].join('\n'),
    )
  }

  return raw as Record<RequiredKey, string>
}

const required = readRequired()

export const firebaseConfig = {
  apiKey: required.VITE_FIREBASE_API_KEY,
  authDomain: required.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: required.VITE_FIREBASE_PROJECT_ID,
  storageBucket: required.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: required.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: required.VITE_FIREBASE_APP_ID,
} as const

/** Opt-in, not opt-out: anything other than the exact string "true" means the real project. */
export const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true'

/** Must match the emulator ports declared in firebase.json. */
export const EMULATOR_HOST = '127.0.0.1'
export const AUTH_EMULATOR_PORT = 9099
export const FIRESTORE_EMULATOR_PORT = 8080
