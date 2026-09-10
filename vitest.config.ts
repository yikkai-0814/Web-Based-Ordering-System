import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// Two suites live under tests/:
//   tests/unit  — pure logic, no emulator, run by `npm run test:unit`
//   tests/rules — security rules, needs the Firestore emulator, run by `npm run test:rules`
// The scripts pass the directory, so this config only needs the shared setup.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The emulator can be slow to answer the first request after start-up.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
