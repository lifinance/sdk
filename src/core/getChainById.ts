import type { ChainId } from '@lifi/types'
import { ChainType } from '@lifi/types'
import { getChains } from '../services/api.js'
import type { SDKBaseConfig } from './types.js'

export async function getChainById(config: SDKBaseConfig, chainId: ChainId) {
  const chains = await getChains(config, {
    chainTypes: [ChainType.EVM, ChainType.SVM, ChainType.UTXO, ChainType.MVM],
  })
  const chain = chains?.find((chain) => chain.id === chainId)
  if (!chain) {
    throw new Error(`ChainId ${chainId} not found`)
  }
  return chain
}
