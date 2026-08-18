import { ChainId, type SDKClient } from '@lifi/sdk'
import { SuiGrpcClient } from '@mysten/sui/grpc'

const clients = new Map<string, SuiGrpcClient>()

/**
 * Initializes the Sui clients if they haven't been initialized yet.
 * @returns - Promise that resolves when clients are initialized.
 */
const ensureClients = async (client: SDKClient): Promise<void> => {
  const rpcUrls = await client.getRpcUrlsByChainId(ChainId.SUI)
  for (const rpcUrl of rpcUrls) {
    if (!clients.get(rpcUrl)) {
      const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: rpcUrl })
      clients.set(rpcUrl, client)
    }
  }
}

/**
 * Calls a function on the SuiGrpcClient instances with retry logic.
 * @param client - The SDK client
 * @param fn - The function to call, which receives a SuiGrpcClient instance.
 * @returns - The result of the function call.
 */
export async function callSuiWithRetry<R>(
  client: SDKClient,
  fn: (client: SuiGrpcClient) => Promise<R>
): Promise<R> {
  // Ensure clients are initialized
  await ensureClients(client)
  let lastError: any = null
  for (const client of clients.values()) {
    try {
      const result = await fn(client)
      return result
    } catch (error) {
      lastError = error
    }
  }
  // Throw the last encountered error
  throw lastError
}
