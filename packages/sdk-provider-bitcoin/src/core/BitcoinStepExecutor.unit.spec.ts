import type { Client } from '@bigmi/core'
import {
  CheckBalanceTask,
  type ExecutionAction,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import type { BitcoinStepExecutorContext } from '../types.js'
import { BitcoinStepExecutor } from './BitcoinStepExecutor.js'
import { BitcoinSignAndExecuteTask } from './tasks/BitcoinSignAndExecuteTask.js'
import { BitcoinWaitForTransactionTask } from './tasks/BitcoinWaitForTransactionTask.js'

const TX_HASH = 'ab'.repeat(32)

/** Reads the private task list out of the pipeline the executor built. */
const taskNames = (actions: ExecutionAction[]): string[] => {
  const executor = new BitcoinStepExecutor({
    routeId: 'route-1',
    client: {} as Client,
  })
  const pipeline = executor.createPipeline({
    step: { execution: { status: 'PENDING', actions } },
    isBridgeExecution: false,
  } as unknown as BitcoinStepExecutorContext)
  return (pipeline as unknown as { tasks: object[] }).tasks.map(
    (task) => task.constructor.name
  )
}

describe('BitcoinStepExecutor.createPipeline', () => {
  it('starts from CheckBalanceTask on a fresh run', () => {
    expect(taskNames([])[0]).toBe(CheckBalanceTask.name)
  })

  it('signs again from CheckBalanceTask after a final failure', () => {
    const names = taskNames([
      {
        type: 'SWAP',
        status: 'FAILED',
        txHash: TX_HASH,
        txHex: 'SIGNED_TX_HEX',
        txFinal: true,
      },
    ])

    expect(names[0]).toBe(CheckBalanceTask.name)
    expect(names).toContain(BitcoinSignAndExecuteTask.name)
  })

  it('waits for a FAILED transaction without txFinal instead of signing', () => {
    const names = taskNames([
      {
        type: 'SWAP',
        status: 'FAILED',
        txHash: TX_HASH,
        txHex: 'SIGNED_TX_HEX',
      },
    ])

    expect(names[0]).toBe(BitcoinWaitForTransactionTask.name)
    expect(names).not.toContain(BitcoinSignAndExecuteTask.name)
  })

  // Same predicate as the pre-sign guard. A selector keyed on `txHash` alone
  // would route this to signing, where the guard throws TransactionConflict.
  it('waits for an action that holds stored bytes only', () => {
    const names = taskNames([
      { type: 'SWAP', status: 'PENDING', txHex: 'SIGNED_TX_HEX' },
    ])

    expect(names[0]).toBe(BitcoinWaitForTransactionTask.name)
  })

  it('goes to the status wait once the transaction is DONE', () => {
    const names = taskNames([
      { type: 'SWAP', status: 'DONE', txHash: TX_HASH, txHex: 'SIGNED_TX_HEX' },
    ])

    expect(names).toEqual([WaitForTransactionStatusTask.name])
  })
})
