import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths() as any],
  test: {
    setupFiles: ['./tests/setupEnv.ts'],
    dangerouslyIgnoreUnhandledErrors: true,
  },
})
