import { ChainId, type SDKClient } from '@lifi/sdk'
import { createSolanaRpc, type Rpc } from '@solana/kit'
import { callWithRetry } from '../utils/callWithRetry.js'
import { createJitoRpc, type JitoRpcApi } from './jito/createJitoRpc.js'

type SolanaRpcType = ReturnType<typeof createSolanaRpc>
type JitoRpcType = Rpc<JitoRpcApi>

const solanaRpcs = new Map<string, SolanaRpcType>()
const jitoRpcs = new Map<string, JitoRpcType>()

/**
 * Checks if an RPC URL supports Jito methods by calling getTipAccounts.
 */
const isJitoRpc = async (rpcUrl: string): Promise<boolean> => {
  try {
    const rpc = createJitoRpc(rpcUrl)
    await rpc.getTipAccounts().send()
    return true
  } catch {
    return false
  }
}

/**
 * Initializes the Solana and Jito connections if they haven't been initialized yet.
 * Detects Jito RPCs by checking if they support the getTipAccounts method.
 * @returns - Promise that resolves when connections are initialized.
 */
const ensureConnections = async (client: SDKClient): Promise<void> => {
  const rpcUrls = await client.getRpcUrlsByChainId(ChainId.SOL)
  for (const rpcUrl of rpcUrls) {
    // Skip if already categorized
    if (solanaRpcs.has(rpcUrl) || jitoRpcs.has(rpcUrl)) {
      continue
    }

    // Check if it's a Jito RPC
    if (await isJitoRpc(rpcUrl)) {
      jitoRpcs.set(rpcUrl, createJitoRpc(rpcUrl))
    } else {
      solanaRpcs.set(rpcUrl, createSolanaRpc(rpcUrl))
    }
  }
}

/**
 * Wrapper around getting the connection (RPC provider) for Solana
 * @returns - Solana RPC connections
 */
export const getSolanaConnections = async (
  client: SDKClient
): Promise<SolanaRpcType[]> => {
  await ensureConnections(client)
  return Array.from(solanaRpcs.values())
}

/**
 * Wrapper around getting the Jito RPC connections
 * @returns - Jito RPC connections
 */
export const getJitoConnections = async (
  client: SDKClient
): Promise<JitoRpcType[]> => {
  await ensureConnections(client)
  return Array.from(jitoRpcs.values())
}

/**
 * Calls a function on the Solana Connection instances with retry logic.
 * @param client - The SDK client
 * @param fn - The function to call, which receives a Connection instance.
 * @returns - The result of the function call.
 */
export async function callSolanaWithRetry<R>(
  client: SDKClient,
  fn: (rpc: SolanaRpcType) => Promise<R>
): Promise<R> {
  await ensureConnections(client)
  return callWithRetry(solanaRpcs, fn)
}

/**
 * Calls a function on the Jito RPC instances with retry logic.
 * @param client - The SDK client
 * @param fn - The function to call, which receives a Jito RPC instance.
 * @returns - The result of the function call.
 */
export async function callJitoWithRetry<R>(
  client: SDKClient,
  fn: (rpc: JitoRpcType) => Promise<R>
): Promise<R> {
  await ensureConnections(client)
  return callWithRetry(jitoRpcs, fn)
}
