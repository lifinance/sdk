import {
  CheckBalanceTask,
  PrepareTransactionTask,
  type TaskPipeline,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TronStepExecutor } from './TronStepExecutor.js'
import { TronCheckAllowanceTask } from './tasks/TronCheckAllowanceTask.js'
import { TronSetAllowanceTask } from './tasks/TronSetAllowanceTask.js'
import { TronSignAndExecuteTask } from './tasks/TronSignAndExecuteTask.js'
import { TronWaitForTransactionTask } from './tasks/TronWaitForTransactionTask.js'

// TRC-20 USDT: not the Tron zero address, so the allowance gate depends only
// on the approval address and the action.
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const TRX = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
const APPROVAL_ADDRESS = 'TXjLFuYRJq9wKhvmpxPeDmhmvDHQhd5k8b'
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

const contextWith = (
  options: {
    actions?: object[]
    fromToken?: string
    approvalAddress?: string
    isBridgeExecution?: boolean
  } = {}
) =>
  ({
    step: {
      action: { fromToken: { address: options.fromToken ?? USDT } },
      estimate: {
        approvalAddress: options.approvalAddress,
        skipApproval: false,
      },
      execution: { actions: options.actions ?? [] },
    },
    isBridgeExecution: options.isBridgeExecution ?? false,
  }) as never

describe('TronStepExecutor', () => {
  describe('createPipeline', () => {
    it('checks the allowance first on a fresh token route', () => {
      expect(
        taskNames(contextWith({ approvalAddress: APPROVAL_ADDRESS }))[0]
      ).toBe(TronCheckAllowanceTask.name)
    })

    it('starts from CheckBalanceTask on a fresh native route', () => {
      expect(
        taskNames(
          contextWith({ approvalAddress: APPROVAL_ADDRESS, fromToken: TRX })
        )[0]
      ).toBe(CheckBalanceTask.name)
    })

    // The reload right after signing: the bytes are stored, nothing confirms
    // a broadcast yet. Re-checking the allowance or signing again could
    // execute the swap twice.
    it('resumes at the confirmation wait when only the signed bytes are stored', () => {
      for (const fromToken of [USDT, TRX]) {
        const names = taskNames(
          contextWith({
            approvalAddress: APPROVAL_ADDRESS,
            fromToken,
            actions: [
              { type: 'SWAP', status: 'PENDING', txHex: SIGNED_TX_JSON },
            ],
          })
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
          contextWith({
            approvalAddress: APPROVAL_ADDRESS,
            actions: [{ type: 'SWAP', status, txHash: 'c3e7' }],
          })
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
          contextWith({
            approvalAddress: APPROVAL_ADDRESS,
            actions: [{ type: 'SWAP', status: 'DONE', txHash: 'c3e7' }],
          })
        )
      ).toEqual([WaitForTransactionStatusTask.name])
    })

    it('signs again after a final failure', () => {
      const names = taskNames(
        contextWith({
          approvalAddress: APPROVAL_ADDRESS,
          actions: [
            { type: 'SWAP', status: 'FAILED', txHash: 'c3e7', txFinal: true },
          ],
        })
      )

      expect(names[0]).toBe(TronCheckAllowanceTask.name)
      expect(names).toContain(TronSignAndExecuteTask.name)
    })

    it('signs again after a final failure on a native route', () => {
      const names = taskNames(
        contextWith({
          approvalAddress: APPROVAL_ADDRESS,
          fromToken: TRX,
          actions: [
            {
              type: 'SWAP',
              status: 'FAILED',
              txHash: 'c3e7',
              txHex: SIGNED_TX_JSON,
              txFinal: true,
            },
          ],
        })
      )

      expect(names[0]).toBe(CheckBalanceTask.name)
      expect(names).toContain(TronSignAndExecuteTask.name)
    })

    it('reads the CROSS_CHAIN action of a bridge', () => {
      const names = taskNames(
        contextWith({
          approvalAddress: APPROVAL_ADDRESS,
          isBridgeExecution: true,
          actions: [{ type: 'CROSS_CHAIN', status: 'PENDING', txHash: 'c3e7' }],
        })
      )

      expect(names[0]).toBe(TronWaitForTransactionTask.name)
      expect(names).not.toContain(TronCheckAllowanceTask.name)
      expect(names).not.toContain(TronSignAndExecuteTask.name)
    })

    // `waitForTronTxConfirmation` is shared with TronSetAllowanceTask, so a
    // final approval failure flags SET_ALLOWANCE. Only the tx action counts.
    it('ignores a final flag on SET_ALLOWANCE', () => {
      const names = taskNames(
        contextWith({
          approvalAddress: APPROVAL_ADDRESS,
          actions: [
            {
              type: 'SET_ALLOWANCE',
              status: 'FAILED',
              txHash: 'c3e7',
              txFinal: true,
            },
          ],
        })
      )

      expect(names[0]).toBe(TronCheckAllowanceTask.name)
    })

    // An approval in flight is not the swap transaction: the allowance task
    // owns its own wait, and nothing was signed for the swap yet.
    it('ignores an open SET_ALLOWANCE transaction', () => {
      const names = taskNames(
        contextWith({
          approvalAddress: APPROVAL_ADDRESS,
          actions: [
            { type: 'SET_ALLOWANCE', status: 'PENDING', txHash: 'a11c' },
          ],
        })
      )

      expect(names[0]).toBe(TronCheckAllowanceTask.name)
    })
  })
})

type TaskClass = abstract new (...args: never[]) => object

// The order in which createPipeline builds the tasks.
const TRON_TASKS: TaskClass[] = [
  TronCheckAllowanceTask,
  TronSetAllowanceTask,
  CheckBalanceTask,
  PrepareTransactionTask,
  TronSignAndExecuteTask,
  TronWaitForTransactionTask,
  WaitForTransactionStatusTask,
]

const taskClasses = (pipeline: TaskPipeline): unknown[] =>
  (pipeline as unknown as { tasks: object[] }).tasks.map(
    (task) => task.constructor
  )

const tasksFrom = (first: TaskClass): TaskClass[] =>
  TRON_TASKS.slice(TRON_TASKS.indexOf(first))

// A minifier renames every module-local class binding on its own, so two
// classes can end up with the same `name`. Give all of them one
// name and return a function that restores the originals.
const giveEveryTaskClassTheSameName = (classes: TaskClass[]): (() => void) => {
  const originals = classes.map((taskClass) =>
    Object.getOwnPropertyDescriptor(taskClass, 'name')
  )
  for (const taskClass of classes) {
    Object.defineProperty(taskClass, 'name', { value: 'i', configurable: true })
  }
  return () => {
    for (const [index, taskClass] of classes.entries()) {
      const original = originals[index]
      if (original) {
        Object.defineProperty(taskClass, 'name', original)
      }
    }
  }
}

describe('TronStepExecutor.createPipeline when every task class has the same name', () => {
  let restoreNames: () => void = () => {}

  beforeEach(() => {
    restoreNames = giveEveryTaskClassTheSameName(TRON_TASKS)
  })

  afterEach(() => {
    restoreNames()
  })

  it('simulates the minifier collision', () => {
    expect(new Set(TRON_TASKS.map((taskClass) => taskClass.name))).toEqual(
      new Set(['i'])
    )
  })

  it('starts at TronCheckAllowanceTask when an approval is needed', () => {
    expect(
      taskClasses(
        makeExecutor().createPipeline(
          contextWith({ approvalAddress: APPROVAL_ADDRESS })
        )
      )
    ).toEqual(tasksFrom(TronCheckAllowanceTask))
  })

  it('starts at CheckBalanceTask when no approval is needed', () => {
    expect(taskClasses(makeExecutor().createPipeline(contextWith()))).toEqual(
      tasksFrom(CheckBalanceTask)
    )
  })

  // A hash on a not-DONE action may still land: skip the allowance, wait for
  // it, never sign again.
  it('resumes at TronWaitForTransactionTask when a hash exists but the action is not DONE', () => {
    expect(
      taskClasses(
        makeExecutor().createPipeline(
          contextWith({
            approvalAddress: APPROVAL_ADDRESS,
            actions: [{ type: 'SWAP', status: 'PENDING', txHash: 'tx-1' }],
          })
        )
      )
    ).toEqual(tasksFrom(TronWaitForTransactionTask))
  })

  it('resumes at WaitForTransactionStatusTask when the action is DONE', () => {
    expect(
      taskClasses(
        makeExecutor().createPipeline(
          contextWith({
            approvalAddress: APPROVAL_ADDRESS,
            actions: [{ type: 'SWAP', status: 'DONE', txHash: 'tx-1' }],
          })
        )
      )
    ).toEqual(tasksFrom(WaitForTransactionStatusTask))
  })

  it('resumes a bridge at WaitForTransactionStatusTask when the CROSS_CHAIN action is DONE', () => {
    expect(
      taskClasses(
        makeExecutor().createPipeline(
          contextWith({
            approvalAddress: APPROVAL_ADDRESS,
            isBridgeExecution: true,
            actions: [{ type: 'CROSS_CHAIN', status: 'DONE', txHash: 'tx-1' }],
          })
        )
      )
    ).toEqual(tasksFrom(WaitForTransactionStatusTask))
  })
})
