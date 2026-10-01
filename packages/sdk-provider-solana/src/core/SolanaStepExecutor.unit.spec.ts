import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import type { Wallet } from '@wallet-standard/base'
import { describe, expect, it } from 'vitest'
import { SolanaStepExecutor } from './SolanaStepExecutor.js'

const FROM_ADDRESS = 'FromAddress111111111111111111111111111111111'

const makeExecutor = (accounts: { address: string }[] = []) =>
  new SolanaStepExecutor({
    wallet: { accounts } as unknown as Wallet,
    routeId: 'route-1',
  })

/**
 * Runs `call` and returns whatever it threw, or `undefined` when it returned
 * normally.
 */
const thrownBy = (call: () => void): unknown => {
  try {
    call()
  } catch (error) {
    return error
  }
  return undefined
}

describe('SolanaStepExecutor', () => {
  describe('createContext', () => {
    it('builds the context without the wallet account', async () => {
      // A resume that only waits never signs. Resolving the account here
      // failed it whenever the Solana wallet had not reconnected yet after a
      // reload.
      const executor = makeExecutor([])
      const step = { action: { fromAddress: FROM_ADDRESS } }

      const context = await executor.createContext({ step } as never)

      const thrown = thrownBy(() => context.getWalletAccount(step as never))
      expect(thrown).toBeInstanceOf(TransactionError)
      expect((thrown as TransactionError).code).toBe(
        LiFiErrorCode.WalletChangedDuringExecution
      )
    })

    it('resolves the quoting account through the context', async () => {
      const account = { address: FROM_ADDRESS }
      const executor = makeExecutor([account])
      const step = { action: { fromAddress: FROM_ADDRESS } }

      const context = await executor.createContext({ step } as never)

      expect(context.getWalletAccount(step as never)).toBe(account)
    })
  })
})
