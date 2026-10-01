import {
  CheckBalanceTask,
  PrepareTransactionTask,
  type TaskPipeline,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BitcoinStepExecutor } from './BitcoinStepExecutor.js'
import { BitcoinSignAndExecuteTask } from './tasks/BitcoinSignAndExecuteTask.js'
import { BitcoinWaitForTransactionTask } from './tasks/BitcoinWaitForTransactionTask.js'

type TaskClass = abstract new (...args: never[]) => object

// The order in which createPipeline builds the tasks.
const BITCOIN_TASKS: TaskClass[] = [
  CheckBalanceTask,
  PrepareTransactionTask,
  BitcoinSignAndExecuteTask,
  BitcoinWaitForTransactionTask,
  WaitForTransactionStatusTask,
]

const buildExecutor = (): BitcoinStepExecutor =>
  new BitcoinStepExecutor({ routeId: 'route-1', client: {} as never })

const contextWith = (actions: object[] = [], isBridgeExecution = false) =>
  ({ step: { execution: { actions } }, isBridgeExecution }) as never

const taskClasses = (pipeline: TaskPipeline): unknown[] =>
  (pipeline as unknown as { tasks: object[] }).tasks.map(
    (task) => task.constructor
  )

const tasksFrom = (first: TaskClass): TaskClass[] =>
  BITCOIN_TASKS.slice(BITCOIN_TASKS.indexOf(first))

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

describe('BitcoinStepExecutor.createPipeline when every task class has the same name', () => {
  let restoreNames: () => void = () => {}

  beforeEach(() => {
    restoreNames = giveEveryTaskClassTheSameName(BITCOIN_TASKS)
  })

  afterEach(() => {
    restoreNames()
  })

  it('simulates the minifier collision', () => {
    expect(new Set(BITCOIN_TASKS.map((taskClass) => taskClass.name))).toEqual(
      new Set(['i'])
    )
  })

  it('starts at CheckBalanceTask on a fresh run', () => {
    expect(taskClasses(buildExecutor().createPipeline(contextWith()))).toEqual(
      tasksFrom(CheckBalanceTask)
    )
  })

  it('resumes at BitcoinWaitForTransactionTask when a hash exists but the action is not DONE', () => {
    expect(
      taskClasses(
        buildExecutor().createPipeline(
          contextWith([{ type: 'SWAP', status: 'PENDING', txHash: '0xabc' }])
        )
      )
    ).toEqual(tasksFrom(BitcoinWaitForTransactionTask))
  })

  it('resumes at WaitForTransactionStatusTask when the action is DONE', () => {
    expect(
      taskClasses(
        buildExecutor().createPipeline(
          contextWith([{ type: 'SWAP', status: 'DONE', txHash: '0xabc' }])
        )
      )
    ).toEqual(tasksFrom(WaitForTransactionStatusTask))
  })

  it('resumes a bridge at WaitForTransactionStatusTask when the CROSS_CHAIN action is DONE', () => {
    expect(
      taskClasses(
        buildExecutor().createPipeline(
          contextWith(
            [{ type: 'CROSS_CHAIN', status: 'DONE', txHash: '0xabc' }],
            true
          )
        )
      )
    ).toEqual(tasksFrom(WaitForTransactionStatusTask))
  })
})
