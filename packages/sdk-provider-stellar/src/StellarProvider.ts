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
import { StellarStepExecutor } from './core/StellarStepExecutor.js'
import type { StellarProviderOptions, StellarSDKProvider } from './types.js'

/**
 * The network every read defaults to when the integrator configures none.
 * Signing prefers the connected wallet's passphrase instead, and
 * `StellarStepExecutor.checkWallet` refuses a route whose networks disagree.
 */
export const DEFAULT_NETWORK_PASSPHRASE: string = Networks.PUBLIC

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
        _options.networkPassphrase ?? DEFAULT_NETWORK_PASSPHRASE
      ),
    async getStepExecutor(options: StepExecutorOptions): Promise<StepExecutor> {
      if (!_options.getWallet) {
        throw new ProviderError(
          LiFiErrorCode.ProviderUnavailable,
          'getWallet is not provided.'
        )
      }
      const wallet = await _options.getWallet()
      return new StellarStepExecutor({
        wallet,
        networkPassphrase:
          _options.networkPassphrase ?? wallet.networkPassphrase,
        routeId: options.routeId,
        executionOptions: { ...options.executionOptions },
      })
    },
    setOptions(options: StellarProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
