import type { ExtendedChain } from '@lifi/sdk'

export const getTronTxLink = (
  chain: ExtendedChain,
  txHash: string
): string | undefined => {
  const explorerUrl = chain.metamask.blockExplorerUrls[0]
  if (!explorerUrl) {
    return undefined
  }
  return `${explorerUrl}#/transaction/${txHash}`
}
