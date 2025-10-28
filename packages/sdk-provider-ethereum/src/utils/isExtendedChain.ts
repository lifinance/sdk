import type { ExtendedChain } from '@lifi/sdk'

export function isExtendedChain(chain: any): chain is ExtendedChain {
  return (
    typeof chain === 'object' &&
    chain !== null &&
    'key' in chain &&
    'chainType' in chain &&
    'coin' in chain &&
    'mainnet' in chain &&
    'logoURI' in chain &&
    typeof chain.metamask === 'object' &&
    chain.metamask !== null &&
    typeof chain.nativeToken === 'object' &&
    chain.nativeToken !== null
  )
}
