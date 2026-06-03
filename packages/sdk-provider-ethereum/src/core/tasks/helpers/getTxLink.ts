import type { ExtendedChain } from '@lifi/sdk'
import type { Hash } from 'viem'

export const getTxLink = (chain: ExtendedChain, txHash: Hash) => {
  return `${chain.metamask.blockExplorerUrls[0]}tx/${txHash}`
}
