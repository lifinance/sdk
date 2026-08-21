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

/** Both leave the endpoint out of the Jito list, but only `unsupported` is a
 * configuration gap the integrator can act on. */
export type JitoProbeOutcome = 'supported' | 'unsupported' | 'unreachable'

/** Retry window for an `unreachable` probe. `unsupported` never expires - a
 * capability gap does not heal - but an outage does, so a permanent entry
 * would keep a recovered endpoint out of the Jito list for the whole process. */
export const JITO_PROBE_RETRY_MS = 30_000

type JitoProbeRecord = { outcome: JitoProbeOutcome; at: number }

/** Every answered probe, the negative ones included. Without them the unprobed
 * set never shrinks, and every bundle submission re-probes every non-Jito
 * endpoint at up to `PROBE_TIMEOUT_MS` each, on the latency path before
 * submission can start. */
const jitoProbes = new LruMap<JitoProbeRecord>(12)

const isProbeFresh = (record: JitoProbeRecord | undefined): boolean => {
  if (!record) {
    return false
  }
  return (
    record.outcome !== 'unreachable' ||
    Date.now() - record.at < JITO_PROBE_RETRY_MS
  )
}

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

/**
 * Bounded because it runs upstream of `raceRpcs`, outside the confirmation
 * budget the SDK documents: an endpoint that accepts the connection and never
 * answers would otherwise stall bundle submission indefinitely.
 */
const PROBE_TIMEOUT_MS = 5_000

/**
 * Probes with `getBundleStatuses` rather than `getTipAccounts`: it is the
 * method bundle confirmation actually uses, and providers such as Helius
 * support it without exposing `getTipAccounts`.
 */
export const probeJitoRpc = async (
  rpcUrl: string
): Promise<JitoProbeOutcome> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const rpc = createJitoRpc(rpcUrl)
    await rpc
      .getBundleStatuses([PROBE_BUNDLE_ID])
      .send({ abortSignal: controller.signal })
    return 'supported'
  } catch (error) {
    return readProbeFailure(error)
  } finally {
    clearTimeout(timer)
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
 * Initializes and caches Jito RPCs for every configured Solana RPC URL.
 *
 * Every probe outcome is cached, so a non-Jito endpoint is probed once rather
 * than once per bundle submission. See `JITO_PROBE_RETRY_MS` for the one
 * outcome that expires.
 * @param client - The SDK client used to fetch RPC URLs.
 */
const ensureJitoRpcs = async (
  client: SDKClient
): Promise<{ rpcUrls: string[]; unreachable: number }> => {
  const rpcUrls = await client.getRpcUrlsByChainId(ChainId.SOL)
  // Probed in parallel: serially, one slow endpoint delayed every URL behind
  // it before submission could start.
  const unprobed = rpcUrls.filter(
    (rpcUrl) => !isProbeFresh(jitoProbes.get(rpcUrl))
  )
  const outcomes = await Promise.all(unprobed.map(probeJitoRpc))

  outcomes.forEach((outcome, index) => {
    const rpcUrl = unprobed[index]
    jitoProbes.set(rpcUrl, { outcome, at: Date.now() })
    if (outcome === 'supported') {
      jitoRpcs.set(rpcUrl, createJitoRpc(rpcUrl))
    } else {
      // An endpoint that used to answer and now does not must leave the list,
      // or `getJitoRpcs` keeps handing out a client for it.
      jitoRpcs.delete(rpcUrl)
    }
  })

  // Counted over every URL, not only the freshly probed ones: a cached
  // `unreachable` still has to reach `sendAndConfirmBundle`, which uses the
  // count to choose between "retry, likely temporary" and "supply a
  // Jito-capable URL".
  const unreachable = rpcUrls.filter(
    (rpcUrl) => jitoProbes.get(rpcUrl)?.outcome === 'unreachable'
  ).length

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
