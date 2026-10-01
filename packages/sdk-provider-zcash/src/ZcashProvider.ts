import {
  ChainId,
  ChainType,
  LiFiErrorCode,
  ProviderError,
  type SDKProvider,
} from '@lifi/sdk'
import { isZcashAddress } from './utils/zcashAddress.js'

export function ZcashProvider(): SDKProvider {
  return {
    get type() {
      return ChainType.UTXO
    },
    chainIds: [ChainId.ZEC],
    isAddress: (address, chainId) =>
      (chainId === undefined || chainId === ChainId.ZEC) &&
      isZcashAddress(address),
    resolveAddress: async () => undefined,
    // No Zcash balance source yet, so every amount stays unknown.
    getBalance: async (_client, _walletAddress, tokens) =>
      tokens.map((token) => ({ ...token })),
    getStepExecutor: async () => {
      throw new ProviderError(
        LiFiErrorCode.ProviderUnavailable,
        'ZEC is a destination-only chain.'
      )
    },
  }
}
