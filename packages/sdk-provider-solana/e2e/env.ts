import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Everything the harness needs to run, once the environment is known good. */
export type E2EEnv = {
  privateKey: string
  rpcUrls: string[]
  /**
   * LI.FI API base URL. Defaults to production; point it at staging to avoid
   * production's shared rate limit, which a full matrix run exhausts.
   */
  apiUrl: string | undefined
  /** Sent as `x-lifi-api-key`. Required by staging, optional on production. */
  apiKey: string | undefined
  /** True only when E2E_EXECUTE is exactly `true`. Anything else is a dry run. */
  execute: boolean
  maxSpendUsd: number
  /**
   * Dollar size of one swap leg. Small legs are cheap but are rejected by AMM
   * slippage checks: at $0.25 a WBTC leg is 348 base units, and pool rounding
   * alone can eat the whole tolerance.
   */
  usdPerLeg: number
}

/** Returned instead of an env when the suite cannot run at all. */
export type E2ESkip = { skip: string }

export const DEFAULT_MAX_SPEND_USD = 10
export const DEFAULT_USD_PER_LEG = 0.5

/** The repo-root `.env`: e2e -> sdk-provider-solana -> packages -> root. */
const REPO_ROOT_ENV: string = resolve(import.meta.dirname, '../../../.env')

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
      `Planned spend $${plannedUsd} exceeds MAX_SPEND_USD $${maxSpendUsd}.`
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

  const rawLeg = process.env.E2E_USD_PER_LEG
  const usdPerLeg = rawLeg ? Number(rawLeg) : DEFAULT_USD_PER_LEG
  if (!Number.isFinite(usdPerLeg) || usdPerLeg <= 0) {
    return { skip: `E2E_USD_PER_LEG is not a positive number: ${rawLeg}` }
  }

  return {
    apiKey: process.env.API_KEY,
    apiUrl: process.env.LIFI_API_URL,
    // Compared against the exact string: `1`, `yes` and `TRUE` are all
    // plausible operator typos, and each one broadcasting would be a bad
    // surprise.
    execute: process.env.E2E_EXECUTE === 'true',
    maxSpendUsd,
    privateKey,
    rpcUrls,
    usdPerLeg,
  }
}

/** Narrows the union so call sites do not each repeat the `in` check. */
export function isSkip(env: E2EEnv | E2ESkip): env is E2ESkip {
  return 'skip' in env
}
