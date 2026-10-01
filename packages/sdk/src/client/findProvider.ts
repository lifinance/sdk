import type { ChainId, ChainType } from '@lifi/types'
import type { SDKProvider } from '../types/core.js'

/**
 * The provider that serves a chain: the one that lists `chainId` in its
 * `chainIds`, otherwise the provider of `chainType` that lists no chains.
 */
export const findProvider = <T extends Pick<SDKProvider, 'type' | 'chainIds'>>(
  providers: readonly T[],
  chainType: ChainType,
  chainId?: ChainId
): T | undefined =>
  (chainId === undefined
    ? undefined
    : providers.find(
        (provider) =>
          provider.type === chainType && provider.chainIds?.includes(chainId)
      )) ??
  providers.find(
    (provider) => provider.type === chainType && !provider.chainIds
  )
