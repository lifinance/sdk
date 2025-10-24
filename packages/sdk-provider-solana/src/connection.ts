import { ChainId, type SDKClient } from '@lifi/sdk'
import { Connection } from '@solana/web3.js'

const connections = new Map<string, Connection>()

/**
 * Initializes the Solana connections if they haven't been initialized yet.
 * @returns - Promise that resolves when connections are initialized.
 */
const ensureConnections = async (client: SDKClient): Promise<void> => {
  const rpcUrls = await client.getRpcUrlsByChainId(ChainId.SOL)
  for (const rpcUrl of rpcUrls) {
    if (!connections.get(rpcUrl)) {
      const connection = new Connection(rpcUrl)
      connections.set(rpcUrl, connection)
    }
  }
}

/**
 * Wrapper around getting the connection (RPC provider) for Solana
 * @returns - Solana RPC connections
 */
export const getSolanaConnections = async (
  client: SDKClient
): Promise<Connection[]> => {
  await ensureConnections(client)
  return Array.from(connections.values())
}

/**
 * Calls a function on the Connection instances with retry logic.
 * @param client - The SDK client
 * @param fn - The function to call, which receives a Connection instance.
 * @returns - The result of the function call.
 */
export async function callSolanaWithRetry<R>(
  client: SDKClient,
  fn: (connection: Connection) => Promise<R>
): Promise<R> {
  // Ensure connections are initialized
  await ensureConnections(client)
  let lastError: any = null
  for (const connection of connections.values()) {
    try {
      const result = await fn(connection)
      return result
    } catch (error) {
      lastError = error
    }
  }
  // Throw the last encountered error
  throw lastError
}
