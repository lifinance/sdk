import {
  CheckBalanceTask,
  PrepareTransactionTask,
  type TaskPipeline,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SolanaStepExecutor } from './SolanaStepExecutor.js'
import { SolanaSignAndExecuteTask } from './tasks/SolanaSignAndExecuteTask.js'
import { SolanaWaitForTransactionTask } from './tasks/SolanaWaitForTransactionTask.js'

type TaskClass = abstract new (...args: never[]) => object

// The order in which createPipeline builds the tasks.
const SOLANA_TASKS: TaskClass[] = [
  CheckBalanceTask,
  PrepareTransactionTask,
  SolanaSignAndExecuteTask,
  SolanaWaitForTransactionTask,
  WaitForTransactionStatusTask,
]

const buildExecutor = (): SolanaStepExecutor =>
  new SolanaStepExecutor({
    routeId: 'route-1',
    wallet: { accounts: [] } as never,
  })

const contextWith = (actions: object[] = [], isBridgeExecution = false) =>
  ({ step: { execution: { actions } }, isBridgeExecution }) as never

const taskClasses = (pipeline: TaskPipeline): unknown[] =>
  (pipeline as unknown as { tasks: object[] }).tasks.map(
    (task) => task.constructor
  )

const tasksFrom = (first: TaskClass): TaskClass[] =>
  SOLANA_TASKS.slice(SOLANA_TASKS.indexOf(first))

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

describe('SolanaStepExecutor.createPipeline when every task class has the same name', () => {
  let restoreNames: () => void

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
    expect(taskClasses(buildExecutor().createPipeline(contextWith()))).toEqual(
      tasksFrom(CheckBalanceTask)
    )
  })

  // Unchanged Solana rule: a hash on a not-DONE action restarts at the balance check.
  it('restarts at CheckBalanceTask when a hash exists but the action is not DONE', () => {
    expect(
      taskClasses(
        buildExecutor().createPipeline(
          contextWith([{ type: 'SWAP', status: 'PENDING', txHash: 'sig-1' }])
        )
      )
    ).toEqual(tasksFrom(CheckBalanceTask))
  })

  it('resumes at WaitForTransactionStatusTask when the action is DONE', () => {
    expect(
      taskClasses(
        buildExecutor().createPipeline(
          contextWith([{ type: 'SWAP', status: 'DONE', txHash: 'sig-1' }])
        )
      )
    ).toEqual(tasksFrom(WaitForTransactionStatusTask))
  })

  it('resumes a bridge at WaitForTransactionStatusTask when the CROSS_CHAIN action is DONE', () => {
    expect(
      taskClasses(
        buildExecutor().createPipeline(
          contextWith(
            [{ type: 'CROSS_CHAIN', status: 'DONE', txHash: 'sig-1' }],
            true
          )
        )
      )
    ).toEqual(tasksFrom(WaitForTransactionStatusTask))
  })
})
