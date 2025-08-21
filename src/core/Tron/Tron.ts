import type { ChainType, Token } from '@lifi/types'
import type { StepExecutor, StepExecutorOptions } from '../types.js'
import { getTronBalance } from './getTronBalance.js'
import { resolveTronAddress } from './resolveTronAddress.js'
import { TronStepExecutor } from './TronStepExecutor.js'
import type { TronProvider, TronProviderOptions } from './types.js'
import { isValidTronAddress } from './utils.js'

export function Tron(options?: TronProviderOptions): TronProvider {
  const _options: TronProviderOptions = options ?? {}
  return {
    get type() {
      return 'TVM' as ChainType
    },
    isAddress: isValidTronAddress,
    resolveAddress: resolveTronAddress,
    getBalance: async (walletAddress: string, tokens: Token[]) => {
      const balance = await getTronBalance(walletAddress)
      return tokens.map((token) => ({
        ...token,
        amount: BigInt(balance),
        blockNumber: 0n,
      }))
    },
    async getStepExecutor(options: StepExecutorOptions): Promise<StepExecutor> {
      if (!_options.getWallet) {
        throw new Error('getWallet is not provided.')
      }

      const wallet = await _options.getWallet()

      const executor = new TronStepExecutor({
        wallet,
        routeId: options.routeId,
        executionOptions: {
          ...options.executionOptions,
        },
      })

      return executor
    },
    setOptions(options: TronProviderOptions) {
      Object.assign(_options, options)
    },
  }
}
