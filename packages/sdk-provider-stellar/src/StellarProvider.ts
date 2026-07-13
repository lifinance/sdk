import {
  ChainType,
  LiFiErrorCode,
  ProviderError,
  type SDKClient,
  type StepExecutor,
  type StepExecutorOptions,
  type Token,
  type TokenAmount,
} from '@lifi/sdk'
import { Networks, StrKey } from '@stellar/stellar-sdk'
import { getStellarBalance } from './actions/getStellarBalance.js'
import { resolveStellarAddress } from './actions/resolveStellarAddress.js'
import type { StellarProviderOptions, StellarSDKProvider } from './types.js'

/**
 * Validates a Stellar account address. Only ed25519 G-addresses are accepted as
 * senders — muxed `M`-addresses and contract `C`-addresses are intentionally
 * rejected (see backend EXBE-227: muxed senders validate-and-throw).
 */
function isStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address)
}

export function StellarProvider(
  options?: StellarProviderOptions
): StellarSDKProvider {
  const _options: StellarProviderOptions = options ?? {}
  return {
    get type() {
      return ChainType.STL
    },
    isAddress: isStellarAddress,
    resolveAddress: resolveStellarAddress,
    getBalance: (
      client: SDKClient,
      walletAddress: string,
      tokens: Token[]
    ): Promise<TokenAmount[]> =>
      getStellarBalance(
        client,
        walletAddress,
        tokens,
        _options.networkPassphrase ?? Networks.PUBLIC
      ),
    async getStepExecutor(
      _stepOptions: StepExecutorOptions
    ): Promise<StepExecutor> {
      // Phase 2: transaction execution is gated on backend tx-generation
      // (EXBE-227). Until StellarStepExecutor lands, fail loudly rather than
      // silently.
      throw new ProviderError(
        LiFiErrorCode.ConfigError,
        'Stellar transaction execution is not yet implemented.'
      )
    },
    setOptions(options: StellarProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
