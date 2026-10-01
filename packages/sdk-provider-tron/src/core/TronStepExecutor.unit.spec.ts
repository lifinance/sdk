import { CheckBalanceTask, WaitForTransactionStatusTask } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { TronStepExecutor } from './TronStepExecutor.js'
import { TronCheckAllowanceTask } from './tasks/TronCheckAllowanceTask.js'
import { TronSignAndExecuteTask } from './tasks/TronSignAndExecuteTask.js'
import { TronWaitForTransactionTask } from './tasks/TronWaitForTransactionTask.js'

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const TRX = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
const SPENDER = 'TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd'
const SIGNED_TX_JSON = '{"txID":"c3e7"}'

const makeExecutor = () =>
  new TronStepExecutor({
    wallet: { address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8' } as never,
    routeId: 'route-1',
  })

/** Reads the private task list out of the pipeline the executor built. */
const taskNames = (context: never): string[] => {
  const pipeline = makeExecutor().createPipeline(context)
  const tasks = (pipeline as unknown as { tasks: object[] }).tasks
  return tasks.map((task) => task.constructor.name)
}

const contextWith = (actions: object[] = [], fromToken = USDT) =>
  ({
    step: {
      action: { fromToken: { address: fromToken } },
      estimate: { approvalAddress: SPENDER, skipApproval: false },
      execution: { actions },
    },
    isBridgeExecution: false,
  }) as never

describe('TronStepExecutor', () => {
  describe('createPipeline', () => {
    it('checks the allowance first on a fresh token route', () => {
      expect(taskNames(contextWith())[0]).toBe(TronCheckAllowanceTask.name)
    })

    it('starts from CheckBalanceTask on a fresh native route', () => {
      expect(taskNames(contextWith([], TRX))[0]).toBe(CheckBalanceTask.name)
    })

    // The reload right after signing: the bytes are stored, nothing confirms
    // a broadcast yet. Re-checking the allowance or signing again could
    // execute the swap twice.
    it('resumes at the confirmation wait when only the signed bytes are stored', () => {
      for (const fromToken of [USDT, TRX]) {
        const names = taskNames(
          contextWith(
            [{ type: 'SWAP', status: 'PENDING', txHex: SIGNED_TX_JSON }],
            fromToken
          )
        )

        expect(names[0], `fromToken=${fromToken}`).toBe(
          TronWaitForTransactionTask.name
        )
        expect(names, `fromToken=${fromToken}`).not.toContain(
          TronCheckAllowanceTask.name
        )
        expect(names, `fromToken=${fromToken}`).not.toContain(
          TronSignAndExecuteTask.name
        )
      }
    })

    it('resumes at the confirmation wait after a broadcast, also after an unknown failure', () => {
      for (const status of ['PENDING', 'ACTION_REQUIRED', 'FAILED']) {
        const names = taskNames(
          contextWith([{ type: 'SWAP', status, txHash: 'c3e7' }])
        )

        expect(names[0], `status=${status}`).toBe(
          TronWaitForTransactionTask.name
        )
        expect(names, `status=${status}`).not.toContain(
          TronCheckAllowanceTask.name
        )
        expect(names, `status=${status}`).not.toContain(
          TronSignAndExecuteTask.name
        )
      }
    })

    it('resumes at the status wait when the swap action is DONE', () => {
      expect(
        taskNames(
          contextWith([{ type: 'SWAP', status: 'DONE', txHash: 'c3e7' }])
        )
      ).toEqual([WaitForTransactionStatusTask.name])
    })

    it('signs again after a final failure', () => {
      const names = taskNames(
        contextWith([
          { type: 'SWAP', status: 'FAILED', txHash: 'c3e7', txFinal: true },
        ])
      )

      expect(names[0]).toBe(TronCheckAllowanceTask.name)
      expect(names).toContain(TronSignAndExecuteTask.name)
    })

    it('signs again after a final failure on a native route', () => {
      const names = taskNames(
        contextWith(
          [
            {
              type: 'SWAP',
              status: 'FAILED',
              txHash: 'c3e7',
              txHex: SIGNED_TX_JSON,
              txFinal: true,
            },
          ],
          TRX
        )
      )

      expect(names[0]).toBe(CheckBalanceTask.name)
      expect(names).toContain(TronSignAndExecuteTask.name)
    })

    it('reads the CROSS_CHAIN action of a bridge', () => {
      const names = taskNames({
        step: {
          action: { fromToken: { address: USDT } },
          estimate: { approvalAddress: SPENDER, skipApproval: false },
          execution: {
            actions: [
              { type: 'CROSS_CHAIN', status: 'PENDING', txHash: 'c3e7' },
            ],
          },
        },
        isBridgeExecution: true,
      } as never)

      expect(names[0]).toBe(TronWaitForTransactionTask.name)
      expect(names).not.toContain(TronCheckAllowanceTask.name)
      expect(names).not.toContain(TronSignAndExecuteTask.name)
    })

    // `waitForTronTxConfirmation` is shared with TronSetAllowanceTask, so a
    // final approval failure flags SET_ALLOWANCE. Only the tx action counts.
    it('ignores a final flag on SET_ALLOWANCE', () => {
      const names = taskNames(
        contextWith([
          {
            type: 'SET_ALLOWANCE',
            status: 'FAILED',
            txHash: 'c3e7',
            txFinal: true,
          },
        ])
      )

      expect(names[0]).toBe(TronCheckAllowanceTask.name)
    })

    // An approval in flight is not the swap transaction: the allowance task
    // owns its own wait, and nothing was signed for the swap yet.
    it('ignores an open SET_ALLOWANCE transaction', () => {
      const names = taskNames(
        contextWith([
          { type: 'SET_ALLOWANCE', status: 'PENDING', txHash: 'a11c' },
        ])
      )

      expect(names[0]).toBe(TronCheckAllowanceTask.name)
    })
  })
})
