import type { ExtendedChain } from '@lifi/sdk'

export const getTronTxLink = (
  chain: ExtendedChain,
  txHash: string
): string | undefined => {
  const explorerUrl = chain.metamask.blockExplorerUrls[0]
  if (!explorerUrl) {
    return undefined
  }
  const base = explorerUrl.endsWith('/') ? explorerUrl.slice(0, -1) : explorerUrl
  return `${base}#/transaction/${txHash}`
}
