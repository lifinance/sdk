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
 * Probes with `getBundleStatuses` rather than `getTipAccounts`: it is the
 * method bundle confirmation actually uses, and providers such as Helius
 * support it without exposing `getTipAccounts`.
 */
/** Both leave the endpoint out of the Jito list, but only `unsupported` is a
 * configuration gap the integrator can act on. */
export type JitoProbeOutcome = 'supported' | 'unsupported' | 'unreachable'

/** `@solana/kit` puts the JSON-RPC code on `context.__code`, not `error.code`.
 * The message is a last resort - a provider can reword it. An unrecognized
 * failure counts as `unreachable`, so a misread blames an outage. */
const JSON_RPC_METHOD_NOT_FOUND = -32601
/** Non-standard; providers use it for "your plan lacks this method". */
const PROVIDER_PLAN_RESTRICTED = -32403

const CAPABILITY_CODES: number[] = [
  JSON_RPC_METHOD_NOT_FOUND,
  PROVIDER_PLAN_RESTRICTED,
]

/** A plan gate rejects before JSON-RPC, so no `-32601` arrives - Helius
 * answers with a bare 403. The server understood and refused, and no retry
 * clears that. 429 and 5xx are absent: those do clear. */
const CAPABILITY_HTTP_STATUSES: number[] = [401, 403]

const readProbeFailure = (error: unknown): JitoProbeOutcome => {
  const candidate = error as
    | {
        code?: unknown
        context?: { __code?: unknown; statusCode?: unknown }
      }
    | undefined

  // kit's `__code` is 8100002 for every HTTP failure, so only a JSON-RPC code
  // that reached the body is meaningful.
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

/** `unreachable` counts endpoints whose probe failed without naming the
 * method unknown. Empty `rpcs` with a non-zero count is an outage, not a
 * configuration gap. */
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
