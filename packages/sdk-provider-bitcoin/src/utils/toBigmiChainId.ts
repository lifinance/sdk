import { ChainId as BigmiChainId } from '@bigmi/core'
import { ChainId } from '@lifi/sdk'

export const toBigmiChainId = (chainId: ChainId): BigmiChainId => {
  switch (chainId) {
    case ChainId.BTC:
      return BigmiChainId.BITCOIN_MAINNET
    default:
      throw new Error(`Unsupported chainId mapping: ${chainId}`)
  }
}
