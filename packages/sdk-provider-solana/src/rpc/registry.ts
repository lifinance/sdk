import { ChainId, type SDKClient } from '@lifi/sdk'
import { createSolanaRpc } from '@solana/kit'
import { createJitoRpc } from './jito/createJitoRpc.js'
import type { JitoRpcType, SolanaRpcType } from './types.js'

const solanaRpcs = new Map<string, SolanaRpcType>()
const jitoRpcs = new Map<string, JitoRpcType>()

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
 * Initializes the Solana and Jito RPCs if they haven't been initialized yet.
 * Detects Jito RPCs by checking if they support the getTipAccounts method.
 * @returns - Promise that resolves when RPCs are initialized.
 */
const ensureRpcs = async (client: SDKClient): Promise<void> => {
  const rpcUrls = await client.getRpcUrlsByChainId(ChainId.SOL)
  const isJitoBundleEnabled = Boolean(client.config.routeOptions?.jitoBundle)

  for (const rpcUrl of rpcUrls) {
    if (solanaRpcs.has(rpcUrl) || jitoRpcs.has(rpcUrl)) {
      continue
    }

    if (isJitoBundleEnabled && (await isJitoRpc(rpcUrl))) {
      jitoRpcs.set(rpcUrl, createJitoRpc(rpcUrl))
    } else {
      solanaRpcs.set(rpcUrl, createSolanaRpc(rpcUrl))
    }
  }
}

/**
 * Wrapper around getting the Solana RPCs
 * @returns - Solana RPCs
 */
export const getSolanaRpcs = async (
  client: SDKClient
): Promise<SolanaRpcType[]> => {
  await ensureRpcs(client)
  return Array.from(solanaRpcs.values())
}

/**
 * Wrapper around getting the Jito RPCs
 * @returns - Jito RPCs
 */
export const getJitoRpcs = async (
  client: SDKClient
): Promise<JitoRpcType[]> => {
  await ensureRpcs(client)
  return Array.from(jitoRpcs.values())
}
