import type { ExtendedChain } from '@lifi/sdk'

export const getStellarTxLink = (
  fromChain: ExtendedChain,
  transactionHash: string
): string => `${fromChain.metamask.blockExplorerUrls[0]}tx/${transactionHash}`
