import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    dangerouslyIgnoreUnhandledErrors: true,
    testTimeout: 999_999_999,
    hookTimeout: 999_999_999,
    include: ['**/?(*.)+(e2e).[tj]s?(x)'],
  },
})
