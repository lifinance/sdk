import { ChainId } from '@lifi/types'
import { SuiClient } from '@mysten/sui/client'
import type { SDKClient } from '../types.js'

const clients = new Map<string, SuiClient>()

/**
 * Initializes the Sui clients if they haven't been initialized yet.
 * @returns - Promise that resolves when clients are initialized.
 */
const ensureClients = async (client: SDKClient): Promise<void> => {
  const rpcUrls = await client.getRpcUrlsByChainId(ChainId.SUI)
  for (const rpcUrl of rpcUrls) {
    if (!clients.get(rpcUrl)) {
      const client = new SuiClient({ url: rpcUrl })
      clients.set(rpcUrl, client)
    }
  }
}

/**
 * Calls a function on the SuiClient instances with retry logic.
 * @param client - The SDK client
 * @param fn - The function to call, which receives a SuiClient instance.
 * @returns - The result of the function call.
 */
export async function callSuiWithRetry<R>(
  client: SDKClient,
  fn: (client: SuiClient) => Promise<R>
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
