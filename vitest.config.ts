import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// Four suites live under tests/:
//   tests/unit        — pure logic, no emulator, run by `npm run test:unit`
//   tests/components  — React components in jsdom, no emulator, `npm run test:components`
//   tests/rules       — security rules, needs the Firestore emulator, `npm run test:rules`
//   tests/integration — the real write APIs against both emulators, `npm run test:integration`
// The scripts pass the directory, so this config only needs the shared setup.
//
// The environment stays `node` here and tests/components opts itself into jsdom with a
// `@vitest-environment` docblock per file. That way the three Node suites — which spend
// their time talking to emulators — are not slowed down by building a DOM they never touch,
// and each component file states the environment it needs where a reader will see it.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // The emulator can be slow to answer the first request after start-up.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // src/lib/env.ts refuses to load without a complete Firebase config, and
    // tests/integration imports it by importing the app's own `db` and `auth`. These are
    // deliberately fixed, obviously-fake values rather than anything read from .env.local:
    // the suite must test the same thing on every machine, and must never depend on — or be
    // able to reach — a real project. The `demo-` project-id prefix is Firebase's own
    // convention for an id the emulators serve and the real backend will never accept.
    env: {
      VITE_USE_EMULATORS: 'true',
      VITE_FIREBASE_PROJECT_ID: 'demo-ordering-system',
      VITE_FIREBASE_API_KEY: 'fake-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'demo-ordering-system.firebaseapp.com',
      VITE_FIREBASE_STORAGE_BUCKET: 'demo-ordering-system.firebasestorage.app',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
      VITE_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000000000',
    },
  },
})
