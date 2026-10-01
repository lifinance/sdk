import { CheckBalanceTask, WaitForTransactionStatusTask } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { TX_HEX } from '../utils/suiSignedTransaction.unit.mock.js'
import { SuiStepExecutor } from './SuiStepExecutor.js'
import { SuiSignAndExecuteTask } from './tasks/SuiSignAndExecuteTask.js'
import { SuiWaitForTransactionTask } from './tasks/SuiWaitForTransactionTask.js'

const makeExecutor = () =>
  new SuiStepExecutor({
    client: {} as never,
    signer: {} as never,
    routeId: 'route-1',
  })

/** Reads the private task list out of the pipeline the executor built. */
const taskNames = (context: never): string[] => {
  const pipeline = makeExecutor().createPipeline(context)
  const tasks = (pipeline as unknown as { tasks: object[] }).tasks
  return tasks.map((task) => task.constructor.name)
}

const contextWith = (actions: object[] = [], isBridgeExecution = false) =>
  ({
    step: { execution: { actions } },
    isBridgeExecution,
  }) as never

describe('SuiStepExecutor', () => {
  describe('createPipeline', () => {
    it('starts from CheckBalanceTask on a fresh run', () => {
      expect(taskNames(contextWith())[0]).toBe(CheckBalanceTask.name)
    })

    // The reload between signing and the end of the execution request: only
    // the signed bytes are stored. Signing again could execute the swap twice.
    it('resumes at the confirmation wait when only the signed bytes are stored', () => {
      const names = taskNames(
        contextWith([{ type: 'SWAP', status: 'PENDING', txHex: TX_HEX }])
      )

      expect(names[0]).toBe(SuiWaitForTransactionTask.name)
      expect(names).not.toContain(SuiSignAndExecuteTask.name)
    })

    it('resumes at the confirmation wait after execution, also after an unknown failure', () => {
      for (const status of ['PENDING', 'FAILED']) {
        const names = taskNames(
          contextWith([{ type: 'SWAP', status, txHash: 'digest' }])
        )

        expect(names[0], `status=${status}`).toBe(
          SuiWaitForTransactionTask.name
        )
        expect(names, `status=${status}`).not.toContain(
          SuiSignAndExecuteTask.name
        )
      }
    })

    it('resumes at the status wait when the swap action is DONE', () => {
      expect(
        taskNames(
          contextWith([{ type: 'SWAP', status: 'DONE', txHash: 'digest' }])
        )
      ).toEqual([WaitForTransactionStatusTask.name])
    })

    it('signs again after a final failure', () => {
      const names = taskNames(
        contextWith([
          { type: 'SWAP', status: 'FAILED', txHash: 'digest', txFinal: true },
        ])
      )

      expect(names[0]).toBe(CheckBalanceTask.name)
      expect(names).toContain(SuiSignAndExecuteTask.name)
    })

    it('reads the CROSS_CHAIN action of a bridge', () => {
      const names = taskNames(
        contextWith(
          [{ type: 'CROSS_CHAIN', status: 'PENDING', txHash: 'digest' }],
          true
        )
      )

      expect(names[0]).toBe(SuiWaitForTransactionTask.name)
      expect(names).not.toContain(SuiSignAndExecuteTask.name)
    })

    // A swap reads only its SWAP action: an open transaction of another action
    // type does not belong to this execution.
    it('ignores an open transaction of another action type', () => {
      expect(
        taskNames(
          contextWith([
            { type: 'CROSS_CHAIN', status: 'PENDING', txHash: 'digest' },
          ])
        )[0]
      ).toBe(CheckBalanceTask.name)
    })
  })
})
