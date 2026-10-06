import { ChainId, LruMap, type SDKClient } from '@lifi/sdk'
import { SuiGrpcClient } from '@mysten/sui/grpc'

// One client per RPC URL, shared by every SDK client in the process. The cap
// keeps a process that sees many URLs (one per tenant, or a changed
// configuration) from holding every client it ever built.
const clients = new LruMap<SuiGrpcClient>(64)

const getSuiClient = (rpcUrl: string): SuiGrpcClient => {
  let suiClient = clients.get(rpcUrl)
  if (!suiClient) {
    suiClient = new SuiGrpcClient({ network: 'mainnet', baseUrl: rpcUrl })
    clients.set(rpcUrl, suiClient)
  }
  return suiClient
}

/**
 * Calls a function on a SuiGrpcClient for each RPC URL of the SDK client, in
 * order, until one call succeeds.
 * @param client - The SDK client
 * @param fn - The function to call, which receives a SuiGrpcClient instance.
 * @returns - The result of the function call.
 */
export async function callSuiWithRetry<R>(
  client: SDKClient,
  fn: (client: SuiGrpcClient) => Promise<R>
): Promise<R> {
  // Only the URLs of this SDK client: another SDK client's URL can carry
  // another tenant's API key.
  const rpcUrls = await client.getRpcUrlsByChainId(ChainId.SUI)
  if (!rpcUrls.length) {
    throw new Error('No Sui RPC URLs available')
  }
  let lastError: any = null
  for (const rpcUrl of rpcUrls) {
    try {
      const result = await fn(getSuiClient(rpcUrl))
      return result
    } catch (error) {
      lastError = error
    }
  }
  // Throw the last encountered error
  throw lastError
}
