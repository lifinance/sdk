import { ChainId, LruMap, type SDKClient } from '@lifi/sdk'
import { createSolanaRpc } from '@solana/kit'
import { createJitoRpc } from './jito/createJitoRpc.js'
import type { JitoRpcType, SolanaRpcType } from './types.js'

const solanaRpcs = new LruMap<SolanaRpcType>(12)
const jitoRpcs = new LruMap<JitoRpcType>(12)

/**
 * A well-formed but non-existent Jito bundle id used solely to probe RPC
 * capability. It forces `getBundleStatuses` to actually execute, so we can tell
 * a Jito-capable RPC (resolves with `{ value: [null] }` — bundle not found)
 * apart from a standard Solana RPC (throws "Method not found").
 *
 * Uses all `1`s: 64 chars, valid as both hex and base-58 (base-58 excludes
 * `0`/`O`/`I`/`l`), so a provider that validates the id in either encoding
 * still accepts it and performs the lookup instead of rejecting the probe.
 */
const PROBE_BUNDLE_ID =
  '1111111111111111111111111111111111111111111111111111111111111111'

/**
 * Checks if an RPC URL supports Jito methods by calling getBundleStatuses.
 * We probe with getBundleStatuses (rather than getTipAccounts) because it is the
 * method actually used during bundle confirmation, and providers such as Helius
 * support sendBundle/getBundleStatuses without exposing getTipAccounts.
 */
export const isJitoRpc = async (rpcUrl: string): Promise<boolean> => {
  return (await probeJitoRpc(rpcUrl)) === 'supported'
}

/**
 * What one Jito capability probe established.
 *
 * `unsupported` and `unreachable` must stay apart. Both leave the endpoint out
 * of the Jito list, but only the first is a configuration gap the integrator
 * can act on; the second is an outage, and telling someone to configure an
 * `rpcUrls` entry they already configured sends them after the wrong problem.
 */
export type JitoProbeOutcome = 'supported' | 'unsupported' | 'unreachable'

/**
 * Reads an endpoint's answer as either "I do not know this method" or "I did
 * not answer".
 *
 * The JSON-RPC code is the reliable signal, but `@solana/kit` does not put it
 * on `error.code`: it throws a `SolanaError` carrying
 * `context.__code === -32601` and a reworded message, verified live against
 * both default LI.FI endpoints. A plain `error.code` is still read first for
 * any transport that does surface it, and the message is a last resort - it is
 * the half a provider can break by localizing or rewording its text.
 *
 * The bias is deliberate: an unrecognized failure counts as `unreachable`, so
 * a misread blames an outage rather than accusing the integrator of a
 * misconfiguration.
 */
const JSON_RPC_METHOD_NOT_FOUND = -32601
/**
 * Not a JSON-RPC standard code. Providers use it for "your plan does not
 * include this method" - a permanent capability answer, so it belongs with
 * `unsupported` rather than with the transient failures. Verified against
 * Helius, which answers `getBundleStatuses` with it on non-business plans;
 * classifying it as an outage told the integrator to retry, which can never
 * clear a plan restriction.
 */
const PROVIDER_PLAN_RESTRICTED = -32403

const CAPABILITY_CODES: number[] = [
  JSON_RPC_METHOD_NOT_FOUND,
  PROVIDER_PLAN_RESTRICTED,
]

/**
 * HTTP statuses that answer the capability question rather than report an
 * outage.
 *
 * A provider that gates bundle methods behind a paid plan rejects the request
 * before it reaches JSON-RPC, so no `-32601` ever arrives - Helius answers
 * `getBundleStatuses` with a bare HTTP 403 on non-business plans, and kit
 * surfaces that as `context.statusCode` with the generic `__code` 8100002 it
 * uses for every HTTP failure.
 *
 * 403 means the server understood the request and refused it: a wrong key, an
 * unentitled plan, a blocked IP. Retrying cannot change any of those, so it
 * belongs with `unsupported`. 401 is the same story for a missing credential.
 * 429 and 5xx are deliberately absent - those really do clear on a retry.
 */
const CAPABILITY_HTTP_STATUSES: number[] = [401, 403]

const readProbeFailure = (error: unknown): JitoProbeOutcome => {
  const candidate = error as
    | {
        code?: unknown
        context?: { __code?: unknown; statusCode?: unknown }
      }
    | undefined

  // `context.__code` is kit's own error code, which is 8100002 for every HTTP
  // failure and so cannot classify anything on its own; only a JSON-RPC code
  // that reached the body is meaningful here.
  const rpcCode = candidate?.code ?? candidate?.context?.__code
  if (typeof rpcCode === 'number' && CAPABILITY_CODES.includes(rpcCode)) {
    return 'unsupported'
  }

  const status = candidate?.context?.statusCode
  if (typeof status === 'number' && CAPABILITY_HTTP_STATUSES.includes(status)) {
    return 'unsupported'
  }

  const message = error instanceof Error ? error.message : String(error)
  return /method not found|method does not exist|-32601|method .* not supported|unsupported method|only available for business plans/i.test(
    message
  )
    ? 'unsupported'
    : 'unreachable'
}

export const probeJitoRpc = async (
  rpcUrl: string
): Promise<JitoProbeOutcome> => {
  try {
    const rpc = createJitoRpc(rpcUrl)
    await rpc.getBundleStatuses([PROBE_BUNDLE_ID]).send()
    return 'supported'
  } catch (error) {
    return readProbeFailure(error)
  }
}

/**
 * Initializes Solana RPCs for all available RPC URLs if they haven't been cached yet.
 * @param client - The SDK client used to fetch RPC URLs.
 */
const ensureSolanaRpcs = async (client: SDKClient): Promise<string[]> => {
  const rpcUrls = await client.getRpcUrlsByChainId(ChainId.SOL)
  for (const rpcUrl of rpcUrls) {
    if (!solanaRpcs.has(rpcUrl)) {
      solanaRpcs.set(rpcUrl, createSolanaRpc(rpcUrl))
    }
  }
  return rpcUrls
}

/**
 * Detects and caches Jito-capable RPCs by checking if they support the getTipAccounts method.
 * @param client - The SDK client used to fetch RPC URLs.
 */
const ensureJitoRpcs = async (
  client: SDKClient
): Promise<{ rpcUrls: string[]; unreachable: number }> => {
  const rpcUrls = await client.getRpcUrlsByChainId(ChainId.SOL)
  let unreachable = 0
  for (const rpcUrl of rpcUrls) {
    if (jitoRpcs.has(rpcUrl)) {
      continue
    }
    const outcome = await probeJitoRpc(rpcUrl)
    if (outcome === 'supported') {
      jitoRpcs.set(rpcUrl, createJitoRpc(rpcUrl))
    } else if (outcome === 'unreachable') {
      unreachable += 1
    }
  }
  return { rpcUrls, unreachable }
}

/**
 * Wrapper around getting the Solana RPCs
 * @returns - Solana RPCs
 */
export const getSolanaRpcs = async (
  client: SDKClient
): Promise<SolanaRpcType[]> => {
  const rpcUrls = await ensureSolanaRpcs(client)
  return rpcUrls
    .map((rpcUrl) => solanaRpcs.get(rpcUrl))
    .filter((rpc): rpc is SolanaRpcType => Boolean(rpc))
}

/**
 * Wrapper around getting the Jito RPCs.
 *
 * `unreachable` counts the configured endpoints whose capability probe failed
 * without saying the method was unknown. An empty `rpcs` with a non-zero
 * `unreachable` is an outage, not a configuration gap - the caller needs the
 * difference to raise an error the integrator can act on.
 */
export const getJitoRpcs = async (
  client: SDKClient
): Promise<{ rpcs: JitoRpcType[]; unreachable: number }> => {
  const { rpcUrls, unreachable } = await ensureJitoRpcs(client)
  return {
    rpcs: rpcUrls
      .map((rpcUrl) => jitoRpcs.get(rpcUrl))
      .filter((rpc): rpc is JitoRpcType => Boolean(rpc)),
    unreachable,
  }
}
