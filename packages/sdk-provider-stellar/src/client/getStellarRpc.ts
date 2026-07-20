import { ChainId, LruMap, type SDKClient } from '@lifi/sdk'
import { rpc } from '@stellar/stellar-sdk'

const stellarRpcs = new LruMap<rpc.Server>(12)

/**
 * Resolves and caches a Stellar RPC (JSON-RPC / Soroban RPC) server for each RPC
 * URL configured for the Stellar chain on the SDK client.
 */
const ensureStellarRpcs = async (client: SDKClient): Promise<string[]> => {
  const rpcUrls = await client.getRpcUrlsByChainId(ChainId.XLM)
  for (const rpcUrl of rpcUrls) {
    if (!stellarRpcs.has(rpcUrl)) {
      stellarRpcs.set(rpcUrl, new rpc.Server(rpcUrl, { allowHttp: true }))
    }
  }
  return rpcUrls
}

export const getStellarRpcs = async (
  client: SDKClient
): Promise<rpc.Server[]> => {
  const rpcUrls = await ensureStellarRpcs(client)
  return rpcUrls
    .map((rpcUrl) => stellarRpcs.get(rpcUrl))
    .filter((server): server is rpc.Server => Boolean(server))
}

/**
 * Calls a function on Stellar RPC instances with retry logic. Tries each RPC in
 * sequence until one succeeds.
 */
export const callStellarRpcsWithRetry = async <R>(
  client: SDKClient,
  fn: (server: rpc.Server) => Promise<R>
): Promise<R> => {
  const servers = await getStellarRpcs(client)
  if (servers.length === 0) {
    throw new Error('No Stellar RPCs available')
  }
  const errors: Error[] = []
  for (const server of servers) {
    try {
      return await fn(server)
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
  }
  throw new AggregateError(errors, `All ${servers.length} Stellar RPCs failed`)
}
