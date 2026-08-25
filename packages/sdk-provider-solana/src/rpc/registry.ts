import { ChainId, LruMap, type SDKClient, withDedupe } from '@lifi/sdk'
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

/** An outcome plus how long it may be trusted. The classifier decides both,
 * because how long an answer is worth is a property of the evidence that
 * produced it, not of the outcome alone. */
export type JitoProbeResult = {
  outcome: JitoProbeOutcome
  /** `Infinity` for an answer that cannot change. */
  retryMs: number
}

/** Retry window for a probe that failed without naming the method unknown.
 * An outage heals, so a permanent entry would keep a recovered endpoint out of
 * the Jito list for the whole process. */
export const JITO_PROBE_RETRY_MS = 30_000

/** Retry window for a bare HTTP 401/403. Longer than an outage's, shorter than
 * forever. The refusal never reached the JSON-RPC layer, so it proves nothing
 * about capability: a plan gate, a provider deploy and an allowlist entry
 * still propagating are indistinguishable here. Treating it as permanent meant
 * one transient 403 removed a working endpoint for the process lifetime;
 * treating it as a 30 s outage would re-probe a real plan gate on the
 * pre-submission latency path twice a minute, forever. */
export const JITO_PROBE_GATEWAY_RETRY_MS: number = 15 * 60_000

type JitoProbeRecord = JitoProbeResult & { at: number }

/** Every answered probe, the negative ones included. Without them the unprobed
 * set never shrinks, and every bundle submission re-probes every non-Jito
 * endpoint at up to `PROBE_TIMEOUT_MS` each, on the latency path before
 * submission can start. */
const jitoProbes = new LruMap<JitoProbeRecord>(12)

/** One rule for every outcome: a record is fresh until its own window closes.
 * `Infinity` covers the answers that cannot change. */
const isProbeFresh = (record: JitoProbeRecord | undefined): boolean =>
  record !== undefined && Date.now() - record.at < record.retryMs

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
 * answers with a bare 403. Unlike a JSON-RPC code this never reached the RPC
 * layer, so it is a gateway verdict rather than a capability answer, and it
 * earns a window instead of permanence. 429 and 5xx are absent: those take the
 * shorter outage window. */
const GATEWAY_REFUSAL_HTTP_STATUSES: number[] = [401, 403]

const readProbeFailure = (error: unknown): JitoProbeResult => {
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
    // The server parsed the request and said it has no such method. Definitive.
    return { outcome: 'unsupported', retryMs: Number.POSITIVE_INFINITY }
  }

  const status = candidate?.context?.statusCode
  if (
    typeof status === 'number' &&
    GATEWAY_REFUSAL_HTTP_STATUSES.includes(status)
  ) {
    return { outcome: 'unreachable', retryMs: JITO_PROBE_GATEWAY_RETRY_MS }
  }

  const message = error instanceof Error ? error.message : String(error)
  return /method not found|method does not exist|-32601|method .* not supported|unsupported method|only available for business plans/i.test(
    message
  )
    ? { outcome: 'unsupported', retryMs: Number.POSITIVE_INFINITY }
    : { outcome: 'unreachable', retryMs: JITO_PROBE_RETRY_MS }
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
): Promise<JitoProbeResult> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const rpc = createJitoRpc(rpcUrl)
    await rpc
      .getBundleStatuses([PROBE_BUNDLE_ID])
      .send({ abortSignal: controller.signal })
    return { outcome: 'supported', retryMs: Number.POSITIVE_INFINITY }
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
 * than once per bundle submission. Each record carries its own retry window:
 * see `JITO_PROBE_RETRY_MS` and `JITO_PROBE_GATEWAY_RETRY_MS` for the two that
 * expire.
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
  // Deduplicated per URL: without it two concurrent submissions each probe
  // every unprobed endpoint, and the slower probe writes last - a 5 s timeout
  // resolving `unreachable` used to overwrite a `supported` answer that landed
  // at 300 ms, evicting a verified-healthy endpoint.
  //
  // `withDedupe` drops its entry in a `.finally`, so this guarantees at most
  // one probe *in flight* per URL, not one probe per URL. The write below waits
  // for the whole batch, so a fast URL's record is unwritten while a slow
  // sibling is still running - up to `PROBE_TIMEOUT_MS` - and every caller
  // arriving in that window re-probes the fast URL. Repeats are therefore
  // bounded by arrivals, not by one.
  //
  // What this does rule out is the clobber: a second probe can only begin
  // after the first has settled, so it always carries the newer answer and
  // always writes second. Write order matches result recency, which is why no
  // timestamp comparison is needed here.
  const results = await Promise.all(
    unprobed.map((rpcUrl) =>
      withDedupe(() => probeJitoRpc(rpcUrl), { id: `jito-probe:${rpcUrl}` })
    )
  )

  results.forEach(({ outcome, retryMs }, index) => {
    const rpcUrl = unprobed[index]
    jitoProbes.set(rpcUrl, { outcome, retryMs, at: Date.now() })
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
 * method unknown. Empty `rpcs` with a non-zero count is usually an outage, but
 * not always: a bare 401/403 lands here too, and that can be a plan gate the
 * integrator has to fix. `sendAndConfirmBundle`'s message names both, because
 * this count cannot tell them apart. */
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
