import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Everything the harness needs to run, once the environment is known good. */
export type E2EEnv = {
  privateKey: string
  rpcUrls: string[]
  /** True only when E2E_EXECUTE is exactly `true`. Anything else is a dry run. */
  execute: boolean
  maxSpendUsd: number
}

/** Returned instead of an env when the suite cannot run at all. */
export type E2ESkip = { skip: string }

export const DEFAULT_MAX_SPEND_USD = 10

/**
 * The repo-root `.env`, four levels up from this file
 * (src/e2e -> src -> sdk-provider-solana -> packages -> repo root).
 */
const REPO_ROOT_ENV: string = resolve(import.meta.dirname, '../../../../.env')

export function parseRpcUrls(raw: string | undefined): string[] {
  if (!raw) {
    return []
  }
  return raw
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
}

/**
 * Throws when the planned spend exceeds the ceiling.
 *
 * The ceiling guards against a mistake in leg sizing rather than against the
 * legs themselves: a decimals error turns a $0.25 swap into a $250,000 one,
 * and nothing else stands between that and the wallet.
 */
export function assertSpendWithinCeiling(
  plannedUsd: number,
  maxSpendUsd: number
): void {
  if (plannedUsd > maxSpendUsd) {
    throw new Error(
      `Planned spend $${plannedUsd} exceeds MAX_SPEND_USD $${maxSpendUsd}. ` +
        'Lower the leg size or raise MAX_SPEND_USD deliberately.'
    )
  }
}

/**
 * Loads the repo-root `.env` and validates it.
 *
 * Returns `{ skip }` rather than throwing when credentials are absent: a
 * contributor without a funded wallet must still be able to run every other
 * test in this package.
 *
 * Uses `process.loadEnvFile` (Node 20.12+) rather than `dotenv`, so the
 * harness adds no dependency. Values already in `process.env` win, which lets
 * CI supply them with no file present.
 */
export function loadE2EEnv(
  envFilePath: string = REPO_ROOT_ENV
): E2EEnv | E2ESkip {
  if (existsSync(envFilePath)) {
    try {
      process.loadEnvFile(envFilePath)
    } catch (error) {
      return {
        skip: `Failed to read ${envFilePath}: ${(error as Error).message}`,
      }
    }
  }

  const privateKey = process.env.SOLANA_PK
  if (!privateKey) {
    return { skip: 'SOLANA_PK is not set (add it to the repo-root .env).' }
  }

  const rpcUrls = parseRpcUrls(process.env.SOLANA_RPC_URLS)
  if (rpcUrls.length === 0) {
    return {
      skip: 'SOLANA_RPC_URLS is not set (comma-separated Solana RPC URLs).',
    }
  }

  const rawCeiling = process.env.MAX_SPEND_USD
  const maxSpendUsd = rawCeiling ? Number(rawCeiling) : DEFAULT_MAX_SPEND_USD
  if (!Number.isFinite(maxSpendUsd) || maxSpendUsd <= 0) {
    return { skip: `MAX_SPEND_USD is not a positive number: ${rawCeiling}` }
  }

  return {
    // Compared against the exact string: `1`, `yes` and `TRUE` are all
    // plausible operator typos, and each one broadcasting would be a bad
    // surprise.
    execute: process.env.E2E_EXECUTE === 'true',
    maxSpendUsd,
    privateKey,
    rpcUrls,
  }
}

/** Narrows the union so call sites do not each repeat the `in` check. */
export function isSkip(env: E2EEnv | E2ESkip): env is E2ESkip {
  return 'skip' in env
}
