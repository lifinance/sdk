import { ChainId } from '@lifi/types'
import { createSolanaRpc } from '@solana/kit'
import { getRpcUrls } from '../rpc.js'

type RpcType = ReturnType<typeof createSolanaRpc>
const rpcs = new Map<string, RpcType>()

/**
 * Initializes the Solana connections if they haven't been initialized yet.
 * @returns - Promise that resolves when connections are initialized.
 */
const ensureConnections = async (): Promise<void> => {
  const rpcUrls = await getRpcUrls(ChainId.SOL)
  for (const rpcUrl of rpcUrls) {
    const rpc = createSolanaRpc(rpcUrl)
    rpcs.set(rpcUrl, rpc)
  }
}

/**
 * Wrapper around getting the connection (RPC provider) for Solana
 * @returns - Solana RPC connections
 */
export const getSolanaConnections = async (): Promise<RpcType[]> => {
  await ensureConnections()
  return Array.from(rpcs.values())
}

/**
 * Calls a function on the Connection instances with retry logic.
 * @param fn - The function to call, which receives a Connection instance.
 * @returns - The result of the function call.
 */
export async function callSolanaWithRetry<R>(
  fn: (rpc: RpcType) => Promise<R>
): Promise<R> {
  // Ensure connections are initialized
  await ensureConnections()
  let lastError: any = null
  for (const rpc of rpcs.values()) {
    try {
      const result = await fn(rpc)
      return result
    } catch (error) {
      lastError = error
    }
  }
  // Throw the last encountered error
  throw lastError
}
