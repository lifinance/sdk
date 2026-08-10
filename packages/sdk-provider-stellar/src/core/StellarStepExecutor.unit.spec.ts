import {
  CheckBalanceTask,
  LiFiErrorCode,
  TransactionError,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { StellarStepExecutor } from './StellarStepExecutor.js'

const keypair = Keypair.random()

const makeExecutor = () =>
  new StellarStepExecutor({
    wallet: {
      address: keypair.publicKey(),
      networkPassphrase: 'Test SDF Network ; September 2015',
      signTransaction: async () => ({ signedTxXdr: '' }),
      signAuthEntry: async () => ({ signedAuthEntry: '' }),
    },
    networkPassphrase: 'Test SDF Network ; September 2015',
    routeId: 'route-1',
  })

/** Reads the private task list out of the pipeline the executor built. */
const taskNames = (executor: StellarStepExecutor, context: never): string[] => {
  const pipeline = executor.createPipeline(context)
  const tasks = (pipeline as unknown as { tasks: object[] }).tasks
  return tasks.map((task) => task.constructor.name)
}

const contextWith = (actions: object[] = []) =>
  ({
    step: { execution: { actions } },
    isBridgeExecution: false,
  }) as never

describe('StellarStepExecutor', () => {
  describe('createPipeline', () => {
    it('orders the allowance tasks BEFORE preparing the transaction', () => {
      const names = taskNames(makeExecutor(), contextWith())

      expect(names).toEqual([
        'CheckBalanceTask',
        'StellarCheckAllowanceTask',
        'StellarSetAllowanceTask',
        'StellarPrepareTransactionTask',
        'StellarSignAndExecuteTask',
        'StellarWaitForTransactionTask',
        'WaitForTransactionStatusTask',
      ])

      // Granting an allowance consumes the sender's sequence number, and the
      // backend builds the route envelope from a live account read — so an
      // envelope prepared first would be invalidated by the approval.
      expect(names.indexOf('StellarSetAllowanceTask')).toBeLessThan(
        names.indexOf('StellarPrepareTransactionTask')
      )
    })

    it('starts from CheckBalanceTask on a fresh run', () => {
      const names = taskNames(makeExecutor(), contextWith())
      expect(names[0]).toBe(CheckBalanceTask.name)
    })

    it('resumes at the status wait when the swap action is already DONE', () => {
      const names = taskNames(
        makeExecutor(),
        contextWith([{ type: 'SWAP', status: 'DONE', txHash: '0xabc' }])
      )

      expect(names).toEqual([WaitForTransactionStatusTask.name])
    })

    // Stellar persists the derived hash BEFORE submitting, so a hash on a
    // not-yet-DONE action means an envelope was signed and very likely
    // broadcast. Restarting from the top would re-prepare, re-sign and submit a
    // second transaction — executing the swap twice.
    it('resumes at the confirmation poll when a hash exists but the action is not DONE', () => {
      for (const status of [
        'PENDING',
        'STARTED',
        'ACTION_REQUIRED',
        'FAILED',
      ]) {
        const names = taskNames(
          makeExecutor(),
          contextWith([{ type: 'SWAP', status, txHash: '0xabc' }])
        )

        expect(names[0], `status=${status}`).toBe(
          'StellarWaitForTransactionTask'
        )
        expect(names, `status=${status}`).not.toContain(
          'StellarSignAndExecuteTask'
        )
      }
    })
  })

  describe('checkWallet', () => {
    it('throws when the connected wallet is not the one that quoted', () => {
      const executor = makeExecutor()
      const other = Keypair.random().publicKey()

      const thrown = (() => {
        try {
          executor.checkWallet({ action: { fromAddress: other } } as never)
        } catch (error) {
          return error
        }
      })()

      expect(thrown).toBeInstanceOf(TransactionError)
      expect((thrown as TransactionError).code).toBe(
        LiFiErrorCode.WalletChangedDuringExecution
      )
    })

    it('passes for the quoting wallet', () => {
      const executor = makeExecutor()
      expect(() =>
        executor.checkWallet({
          action: { fromAddress: keypair.publicKey() },
        } as never)
      ).not.toThrow()
    })
  })
})
