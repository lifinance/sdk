import { ChainId } from '@lifi/types'
import { Connection } from '@solana/web3.js'
import { getRpcUrls } from '../rpc.js'

const connections = new Map<string, Connection>()

/**
 * Initializes the Solana connections if they haven't been initialized yet.
 * @returns - Promise that resolves when connections are initialized.
 */
export const ensureConnections = async (): Promise<void> => {
  const rpcUrls = await getRpcUrls(ChainId.SOL)
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
export const getSolanaConnections = async (): Promise<Connection[]> => {
  await ensureConnections()
  return Array.from(connections.values())
}

/**
 * Calls a function on the Connection instances with retry logic.
 * @param fn - The function to call, which receives a Connection instance.
 * @returns - The result of the function call.
 */
export async function callSolanaWithRetry<R>(
  fn: (connection: Connection) => Promise<R>
): Promise<R> {
  // Ensure connections are initialized
  await ensureConnections()
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
