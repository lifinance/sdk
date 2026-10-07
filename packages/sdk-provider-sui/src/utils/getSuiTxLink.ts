import type { ExtendedChain } from '@lifi/sdk'

export const getSuiTxLink = (chain: ExtendedChain, digest: string): string =>
  `${chain.metamask.blockExplorerUrls[0]}txblock/${digest}`
