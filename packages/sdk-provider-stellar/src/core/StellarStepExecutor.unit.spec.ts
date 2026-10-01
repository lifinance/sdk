import {
  CheckBalanceTask,
  LiFiErrorCode,
  type TaskPipeline,
  TransactionError,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { Keypair } from '@stellar/stellar-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StellarStepExecutor } from './StellarStepExecutor.js'
import { StellarCheckAllowanceTask } from './tasks/StellarCheckAllowanceTask.js'
import { StellarPrepareTransactionTask } from './tasks/StellarPrepareTransactionTask.js'
import { StellarSetAllowanceTask } from './tasks/StellarSetAllowanceTask.js'
import { StellarSignAndExecuteTask } from './tasks/StellarSignAndExecuteTask.js'
import { StellarWaitForTransactionTask } from './tasks/StellarWaitForTransactionTask.js'

const keypair = Keypair.random()

const makeExecutor = () =>
  new StellarStepExecutor({
    wallet: {
      address: keypair.publicKey(),
      networkPassphrase: 'Test SDF Network ; September 2015',
      signTransaction: async () => ({ signedTxXdr: '' }),
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

/**
 * Runs `call` and returns whatever it threw, or `undefined` when it returned
 * normally. The explicit `undefined` keeps the caller's `toBeInstanceOf`
 * assertion failing on a `checkWallet` that let the mismatch through, instead
 * of relying on an implicit fall-through return.
 */
const thrownBy = (call: () => void): unknown => {
  try {
    call()
  } catch (error) {
    return error
  }
  return undefined
}

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

      const thrown = thrownBy(() =>
        executor.checkWallet({ action: { fromAddress: other } } as never)
      )

      expect(thrown).toBeInstanceOf(TransactionError)
      expect((thrown as TransactionError).code).toBe(
        LiFiErrorCode.WalletChangedDuringExecution
      )
    })

    // Balances are simulated against the configured network while the envelope
    // is signed against the wallet's. A mismatch used to surface only as
    // txBAD_AUTH, after the user had signed.
    it('throws when the wallet is connected to a different network', () => {
      const executor = new StellarStepExecutor({
        wallet: {
          address: keypair.publicKey(),
          networkPassphrase: 'Test SDF Network ; September 2015',
          signTransaction: async () => ({ signedTxXdr: '' }),
        },
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        routeId: 'route-1',
      })

      const thrown = thrownBy(() =>
        executor.checkWallet({
          action: { fromAddress: keypair.publicKey() },
        } as never)
      )

      expect(thrown).toBeInstanceOf(TransactionError)
      expect((thrown as TransactionError).code).toBe(
        LiFiErrorCode.ChainSwitchError
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

type TaskClass = abstract new (...args: never[]) => object

// The order in which createPipeline builds the tasks.
const STELLAR_TASKS: TaskClass[] = [
  CheckBalanceTask,
  StellarCheckAllowanceTask,
  StellarSetAllowanceTask,
  StellarPrepareTransactionTask,
  StellarSignAndExecuteTask,
  StellarWaitForTransactionTask,
  WaitForTransactionStatusTask,
]

const taskClasses = (pipeline: TaskPipeline): unknown[] =>
  (pipeline as unknown as { tasks: object[] }).tasks.map(
    (task) => task.constructor
  )

const tasksFrom = (first: TaskClass): TaskClass[] =>
  STELLAR_TASKS.slice(STELLAR_TASKS.indexOf(first))

const bridgeContextWith = (actions: object[]) =>
  ({
    step: { execution: { actions } },
    isBridgeExecution: true,
  }) as never

// A minifier renames every module-local class binding on its own, so two
// classes can end up with the same `name` (JUMEMB-41). Give all of them one
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

describe('StellarStepExecutor.createPipeline when every task class has the same name', () => {
  let restoreNames: () => void

  beforeEach(() => {
    restoreNames = giveEveryTaskClassTheSameName(STELLAR_TASKS)
  })

  afterEach(() => {
    restoreNames()
  })

  it('simulates the minifier collision', () => {
    expect(new Set(STELLAR_TASKS.map((taskClass) => taskClass.name))).toEqual(
      new Set(['i'])
    )
  })

  it('starts at CheckBalanceTask on a fresh run', () => {
    expect(taskClasses(makeExecutor().createPipeline(contextWith()))).toEqual(
      tasksFrom(CheckBalanceTask)
    )
  })

  // A hash means the envelope was very likely broadcast: poll, never sign again.
  it('resumes at StellarWaitForTransactionTask when a hash exists but the action is not DONE', () => {
    expect(
      taskClasses(
        makeExecutor().createPipeline(
          contextWith([{ type: 'SWAP', status: 'PENDING', txHash: '0xabc' }])
        )
      )
    ).toEqual(tasksFrom(StellarWaitForTransactionTask))
  })

  it('resumes at WaitForTransactionStatusTask when the action is DONE', () => {
    expect(
      taskClasses(
        makeExecutor().createPipeline(
          contextWith([{ type: 'SWAP', status: 'DONE', txHash: '0xabc' }])
        )
      )
    ).toEqual(tasksFrom(WaitForTransactionStatusTask))
  })

  it('resumes a bridge at WaitForTransactionStatusTask when the CROSS_CHAIN action is DONE', () => {
    expect(
      taskClasses(
        makeExecutor().createPipeline(
          bridgeContextWith([
            { type: 'CROSS_CHAIN', status: 'DONE', txHash: '0xabc' },
          ])
        )
      )
    ).toEqual(tasksFrom(WaitForTransactionStatusTask))
  })
})
