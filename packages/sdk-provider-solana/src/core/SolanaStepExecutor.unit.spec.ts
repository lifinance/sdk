import {
  CheckBalanceTask,
  LiFiErrorCode,
  PrepareTransactionTask,
  type TaskPipeline,
  TransactionError,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import type { Wallet } from '@wallet-standard/base'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SolanaStepExecutor } from './SolanaStepExecutor.js'
import { SolanaSignAndExecuteTask } from './tasks/SolanaSignAndExecuteTask.js'
import { SolanaWaitForTransactionTask } from './tasks/SolanaWaitForTransactionTask.js'

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

/** Reads the private task list out of the pipeline the executor built. */
const taskNames = (executor: SolanaStepExecutor, context: never): string[] => {
  const pipeline = executor.createPipeline(context)
  const tasks = (pipeline as unknown as { tasks: object[] }).tasks
  return tasks.map((task) => task.constructor.name)
}

const contextWith = (actions: object[] = [], isBridgeExecution = false) =>
  ({
    step: { execution: { actions } },
    isBridgeExecution,
  }) as never

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

  describe('createPipeline', () => {
    it('starts from CheckBalanceTask on a fresh run', () => {
      expect(taskNames(makeExecutor(), contextWith())[0]).toBe(
        CheckBalanceTask.name
      )
    })

    it('resumes at the status wait when the swap action is DONE', () => {
      expect(
        taskNames(
          makeExecutor(),
          contextWith([{ type: 'SWAP', status: 'DONE', txHash: 'sig' }])
        )
      ).toEqual([WaitForTransactionStatusTask.name])
    })

    it('resumes at the Solana wait, and never signs or fetches a new quote, while the transaction may still land', () => {
      // JUMEMB-79: a same-chain swap stays PENDING with its signature until
      // the LI.FI status is DONE, so a reload in that window restarted at
      // CheckBalanceTask, fetched a new quote and opened the wallet again.
      for (const action of [
        { type: 'SWAP', status: 'PENDING', txHash: 'sig' },
        { type: 'SWAP', status: 'PENDING', txHex: 'AA==' },
        { type: 'SWAP', status: 'ACTION_REQUIRED', txHex: 'AA==' },
        { type: 'SWAP', status: 'FAILED', txHash: 'sig' },
      ]) {
        const names = taskNames(makeExecutor(), contextWith([action]))

        expect(names[0], JSON.stringify(action)).toBe(
          'SolanaWaitForTransactionTask'
        )
        expect(names, JSON.stringify(action)).not.toContain(
          'SolanaSignAndExecuteTask'
        )
        // `getStepTransaction` runs only inside PrepareTransactionTask.
        expect(names, JSON.stringify(action)).not.toContain(
          PrepareTransactionTask.name
        )
      }
    })

    it('signs again after a final failure', () => {
      const names = taskNames(
        makeExecutor(),
        contextWith([
          { type: 'SWAP', status: 'FAILED', txFinal: true, txHash: 'sig' },
        ])
      )

      expect(names[0]).toBe(CheckBalanceTask.name)
      // "Try again" must reach the sign task: the whole pipeline runs.
      expect(names).toEqual([
        CheckBalanceTask.name,
        PrepareTransactionTask.name,
        'SolanaSignAndExecuteTask',
        'SolanaWaitForTransactionTask',
        WaitForTransactionStatusTask.name,
      ])
    })

    it('reads the CROSS_CHAIN action of a bridge', () => {
      const names = taskNames(
        makeExecutor(),
        contextWith(
          [
            { type: 'SWAP', status: 'PENDING' },
            { type: 'CROSS_CHAIN', status: 'PENDING', txHash: 'sig' },
          ],
          true
        )
      )

      expect(names[0]).toBe('SolanaWaitForTransactionTask')
    })

    it('ignores an open transaction on an action of another type', () => {
      // The selector reads only the action that the sign task signs and
      // guards (SWAP, or CROSS_CHAIN on a bridge).
      for (const [actions, isBridgeExecution] of [
        [
          [
            { type: 'SET_ALLOWANCE', status: 'PENDING', txHash: 'sig' },
            { type: 'SWAP', status: 'PENDING' },
          ],
          false,
        ],
        [
          [
            { type: 'CROSS_CHAIN', status: 'PENDING', txHash: 'sig' },
            { type: 'SWAP', status: 'PENDING' },
          ],
          false,
        ],
        [
          [
            { type: 'SWAP', status: 'PENDING', txHash: 'sig' },
            { type: 'CROSS_CHAIN', status: 'PENDING' },
          ],
          true,
        ],
      ] as const) {
        const names = taskNames(
          makeExecutor(),
          contextWith([...actions], isBridgeExecution)
        )

        expect(names[0], JSON.stringify(actions)).toBe(CheckBalanceTask.name)
      }
    })
  })
})

type TaskClass = abstract new (...args: never[]) => object

// The order in which createPipeline builds the tasks.
const SOLANA_TASKS: TaskClass[] = [
  CheckBalanceTask,
  PrepareTransactionTask,
  SolanaSignAndExecuteTask,
  SolanaWaitForTransactionTask,
  WaitForTransactionStatusTask,
]

const taskClasses = (pipeline: TaskPipeline): unknown[] =>
  (pipeline as unknown as { tasks: object[] }).tasks.map(
    (task) => task.constructor
  )

const tasksFrom = (first: TaskClass): TaskClass[] =>
  SOLANA_TASKS.slice(SOLANA_TASKS.indexOf(first))

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

describe('SolanaStepExecutor.createPipeline when every task class has the same name', () => {
  let restoreNames: () => void = () => {}

  beforeEach(() => {
    restoreNames = giveEveryTaskClassTheSameName(SOLANA_TASKS)
  })

  afterEach(() => {
    restoreNames()
  })

  it('simulates the minifier collision', () => {
    expect(new Set(SOLANA_TASKS.map((taskClass) => taskClass.name))).toEqual(
      new Set(['i'])
    )
  })

  it('starts at CheckBalanceTask on a fresh run', () => {
    expect(taskClasses(makeExecutor().createPipeline(contextWith()))).toEqual(
      tasksFrom(CheckBalanceTask)
    )
  })

  // A signature on a not-DONE action may still land: wait for it, never sign
  // again.
  it('resumes at SolanaWaitForTransactionTask when a hash exists but the action is not DONE', () => {
    expect(
      taskClasses(
        makeExecutor().createPipeline(
          contextWith([{ type: 'SWAP', status: 'PENDING', txHash: 'sig-1' }])
        )
      )
    ).toEqual(tasksFrom(SolanaWaitForTransactionTask))
  })

  it('resumes at WaitForTransactionStatusTask when the action is DONE', () => {
    expect(
      taskClasses(
        makeExecutor().createPipeline(
          contextWith([{ type: 'SWAP', status: 'DONE', txHash: 'sig-1' }])
        )
      )
    ).toEqual(tasksFrom(WaitForTransactionStatusTask))
  })

  it('resumes a bridge at WaitForTransactionStatusTask when the CROSS_CHAIN action is DONE', () => {
    expect(
      taskClasses(
        makeExecutor().createPipeline(
          contextWith(
            [{ type: 'CROSS_CHAIN', status: 'DONE', txHash: 'sig-1' }],
            true
          )
        )
      )
    ).toEqual(tasksFrom(WaitForTransactionStatusTask))
  })
})
