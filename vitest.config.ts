import { defineConfig } from 'vitest/config'

// Rules tests talk to the Firestore emulator over HTTP, so they run in a Node
// environment rather than jsdom.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The emulator can be slow to answer the first request after start-up.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
