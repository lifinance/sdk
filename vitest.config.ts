// import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // plugins: [tsconfigPaths() as any],
  test: {
    // Deliberately absent: `dangerouslyIgnoreUnhandledErrors`. Suppressing it
    // repo-wide hid the one failure class detached promises introduce - a
    // leaked rejection was reported and the run still exited 0.
    coverage: {
      provider: 'v8',
    },
  },
})
