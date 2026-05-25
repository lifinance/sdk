import { ChainId, LruMap, type SDKClient } from '@lifi/sdk'
import { createSolanaRpc } from '@solana/kit'
import { createJitoRpc } from './jito/createJitoRpc.js'
import type { JitoRpcType, SolanaRpcType } from './types.js'

const solanaRpcs = new LruMap<SolanaRpcType>(12)
const jitoRpcs = new LruMap<JitoRpcType>(12)

/**
 * Checks if an RPC URL supports Jito methods by calling getTipAccounts.
 */
export const isJitoRpc = async (rpcUrl: string): Promise<boolean> => {
  try {
    const rpc = createJitoRpc(rpcUrl)
    await rpc.getTipAccounts().send()
    return true
  } catch {
    return false
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
 * Detects and caches Jito-capable RPCs by checking if they support the getTipAccounts method.
 * @param client - The SDK client used to fetch RPC URLs.
 */
const ensureJitoRpcs = async (client: SDKClient): Promise<string[]> => {
  const rpcUrls = await client.getRpcUrlsByChainId(ChainId.SOL)
  for (const rpcUrl of rpcUrls) {
    if (!jitoRpcs.has(rpcUrl) && (await isJitoRpc(rpcUrl))) {
      jitoRpcs.set(rpcUrl, createJitoRpc(rpcUrl))
    }
  }
  return rpcUrls
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

/**
 * Wrapper around getting the Jito RPCs
 * @returns - Jito RPCs
 */
export const getJitoRpcs = async (
  client: SDKClient
): Promise<JitoRpcType[]> => {
  const rpcUrls = await ensureJitoRpcs(client)
  return rpcUrls
    .map((rpcUrl) => jitoRpcs.get(rpcUrl))
    .filter((rpc): rpc is JitoRpcType => Boolean(rpc))
}
