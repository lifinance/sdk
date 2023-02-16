import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/setupEnv.ts'],
    dangerouslyIgnoreUnhandledErrors: true,
  },
})
