import { defineConfig } from 'vitest/config'

/**
 * Package-level so `dangerouslyIgnoreUnhandledErrors` stays off here alone.
 * The root config sets it repo-wide, which suppressed exactly the failure
 * class the confirmation code's detached promises can leak: a leaked rejection
 * was reported and the run still exited 0.
 *
 * A package config replaces the root one rather than merging with it, so the
 * coverage provider is restated.
 */
export default defineConfig({
  test: {
    dangerouslyIgnoreUnhandledErrors: false,
    coverage: { provider: 'v8' },
  },
})
