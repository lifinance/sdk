import { ChainId, ChainType } from '@lifi/types'
import { getChains } from '../services/api.js'
import { getMergedRPCUrls, getMetamaskRPCUrls } from './configProvider.js'
import type { SDKBaseConfig } from './types.js'

export async function getRpcUrls(
  config: SDKBaseConfig,
  chainId: ChainId
): Promise<string[]> {
  const chains = await getChains(config, {
    chainTypes: [ChainType.EVM, ChainType.SVM, ChainType.UTXO, ChainType.MVM],
  })
  const metamaskRpcUrls = getMetamaskRPCUrls(chains)
  const rpcUrls = getMergedRPCUrls(config.rpcUrls, metamaskRpcUrls, [
    ChainId.SOL,
  ])
  const chainRpcUrls = rpcUrls[chainId]
  if (!chainRpcUrls?.length) {
    throw new Error(`RPC URL not found for chainId: ${chainId}`)
  }
  return chainRpcUrls
}
