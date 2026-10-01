import type { Client } from '@bigmi/core'
import {
  CheckBalanceTask,
  type ExecutionAction,
  MAX_RESEND_AGE_MS,
  StatusManager,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { Psbt } from 'bitcoinjs-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@bigmi/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bigmi/core')>()
  return { ...actual, signPsbt: vi.fn(), waitForTransaction: vi.fn() }
})

import { signPsbt, waitForTransaction } from '@bigmi/core'
import type { BitcoinStepExecutorContext } from '../types.js'
import { BitcoinStepExecutor } from './BitcoinStepExecutor.js'
import { BitcoinSignAndExecuteTask } from './tasks/BitcoinSignAndExecuteTask.js'
import { BitcoinWaitForTransactionTask } from './tasks/BitcoinWaitForTransactionTask.js'

const TX_HASH = 'ab'.repeat(32)
const TX_HEX = 'SIGNED_TX_HEX'
const SENDER = 'bc1qsender'
const NOW = 1_800_000_000_000

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

describe('BitcoinStepExecutor resume of a stored transaction', () => {
  const stopAfterWait = new Error('stop after the wait')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    // The pipeline stops at the chain wait, before the status API task.
    vi.mocked(waitForTransaction).mockRejectedValue(stopAfterWait)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Runs the pipeline the executor builds for the stored action, as a new
   * page or "Try again" does: a fresh context, without `bitcoinSent`.
   */
  const resume = async (
    action: ExecutionAction,
    signedAt: number
  ): Promise<{
    outcome: unknown
    sendUTXOTransaction: ReturnType<typeof vi.fn>
  }> => {
    const executor = new BitcoinStepExecutor({
      routeId: 'route-1',
      client: {} as Client,
    })
    const sendUTXOTransaction = vi.fn().mockResolvedValue(TX_HASH)
    const context = {
      step: {
        action: { fromAddress: SENDER },
        execution: { status: 'PENDING', actions: [action], signedAt },
      },
      isBridgeExecution: false,
      statusManager: {
        findAction: (
          step: { execution: { actions: ExecutionAction[] } },
          type: string
        ) => step.execution.actions.find((stored) => stored.type === type),
        updateAction: vi.fn(),
      },
      walletClient: { account: { address: SENDER } },
      publicClient: { sendUTXOTransaction },
      fromChain: {
        metamask: { blockExplorerUrls: ['https://mempool.space/'] },
      },
      checkClient: vi.fn(),
    } as unknown as BitcoinStepExecutorContext
    const outcome = await executor
      .createPipeline(context)
      .run(context)
      .catch((error: unknown) => error)
    return { outcome, sendUTXOTransaction }
  }

  /** The send went out once with the stored bytes, before the wait. */
  const expectOneResendBeforeTheWait = (
    sendUTXOTransaction: ReturnType<typeof vi.fn>
  ): void => {
    expect(sendUTXOTransaction).toHaveBeenCalledTimes(1)
    expect(sendUTXOTransaction).toHaveBeenCalledWith({ hex: TX_HEX })
    expect(sendUTXOTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(waitForTransaction).mock.invocationCallOrder[0] as number
    )
  }

  // - Written before its send: the write before the send makes this the
  //   state a reload during the send leaves behind.
  // - "Try again" (PENDING): a first-run send that timed out keeps the data
  //   and fails without txFinal; prepareRestart turns the action back to
  //   PENDING.
  // - Previous version: it wrote txHex, txHash and signedAt together, after
  //   the send. Resending the same bytes within the cap is harmless.
  it.each([
    [
      'a transaction written before its send',
      { type: 'SWAP', status: 'PENDING', txHash: TX_HASH, txHex: TX_HEX },
      NOW - 5_000,
    ],
    [
      '"Try again" after a send timeout (PENDING)',
      { type: 'SWAP', status: 'PENDING', txHash: TX_HASH, txHex: TX_HEX },
      NOW - 30_000,
    ],
    [
      'a route stored by the previous version within the cap',
      {
        type: 'SWAP',
        status: 'PENDING',
        txHash: TX_HASH,
        txLink: `https://mempool.space/tx/${TX_HASH}`,
        txHex: TX_HEX,
      },
      NOW - 60_000,
    ],
  ] satisfies [string, ExecutionAction, number][])(
    'resumes %s: resends the same bytes within the cap, waits, never signs',
    async (_label, action, signedAt) => {
      const { outcome, sendUTXOTransaction } = await resume(action, signedAt)

      expect(outcome).toBe(stopAfterWait)
      expectOneResendBeforeTheWait(sendUTXOTransaction)
      expect(waitForTransaction).toHaveBeenCalledTimes(1)
      expect(waitForTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ txId: TX_HASH, txHex: TX_HEX })
      )
      expect(signPsbt).not.toHaveBeenCalled()
    }
  )

  // A first-run send that timed out keeps the data and fails without
  // txFinal.
  it('"Try again" after a send timeout (FAILED) resends the same bytes and never signs again', async () => {
    const { outcome, sendUTXOTransaction } = await resume(
      {
        type: 'SWAP',
        status: 'FAILED',
        txHash: TX_HASH,
        txHex: TX_HEX,
        error: { code: 'UnknownError', message: 'All 1 transports failed' },
      },
      NOW - 30_000
    )

    expect(outcome).toBe(stopAfterWait)
    expectOneResendBeforeTheWait(sendUTXOTransaction)
    expect(signPsbt).not.toHaveBeenCalled()
  })

  it('resumes a route stored by the previous version past the cap without a new signature', async () => {
    const { outcome, sendUTXOTransaction } = await resume(
      {
        type: 'SWAP',
        status: 'PENDING',
        txHash: TX_HASH,
        txLink: `https://mempool.space/tx/${TX_HASH}`,
        txHex: TX_HEX,
      },
      NOW - MAX_RESEND_AGE_MS - 1
    )

    expect(outcome).toBe(stopAfterWait)
    expect(sendUTXOTransaction).not.toHaveBeenCalled()
    expect(waitForTransaction).toHaveBeenCalledTimes(1)
    expect(signPsbt).not.toHaveBeenCalled()
  })
})

describe('BitcoinStepExecutor first run', () => {
  const stopAfterWait = new Error('stop after the wait')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    // The balance check reads balances over the network.
    vi.spyOn(CheckBalanceTask.prototype, 'run').mockResolvedValue({
      status: 'COMPLETED',
    })
    vi.mocked(signPsbt).mockResolvedValue('SIGNED_PSBT' as never)
    // An input-less PSBT keeps the signing path free of real keys.
    vi.spyOn(Psbt, 'fromHex')
      .mockReturnValueOnce({
        data: { inputs: [] },
        toHex: () => 'UNSIGNED_PSBT',
      } as unknown as Psbt)
      .mockReturnValueOnce({
        extractTransaction: () => ({
          toHex: () => TX_HEX,
          getId: () => TX_HASH,
        }),
        finalizeAllInputs: vi.fn(),
      } as unknown as Psbt)
    // The pipeline stops at the chain wait, before the status API task.
    vi.mocked(waitForTransaction).mockRejectedValue(stopAfterWait)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('signs, sends once and waits without a resend in the same run', async () => {
    const executor = new BitcoinStepExecutor({
      routeId: 'route-1',
      client: {} as Client,
    })
    const statusManager = new StatusManager('route-1')
    statusManager.allowUpdates(false)
    const request = vi.fn().mockResolvedValue(TX_HASH)
    // As in bigmi: the resend is a `sendrawtransaction` request too.
    const sendUTXOTransaction = vi.fn(({ hex }: { hex: string }) =>
      request({ method: 'sendrawtransaction', params: [hex] })
    )
    const context = {
      step: {
        action: { fromAddress: SENDER },
        transactionRequest: { data: 'PSBT_HEX' },
        execution: {
          status: 'PENDING',
          actions: [{ type: 'SWAP', status: 'STARTED' }],
        },
      },
      isBridgeExecution: false,
      allowUserInteraction: true,
      statusManager,
      walletClient: { account: { address: SENDER } },
      publicClient: { request, sendUTXOTransaction },
      fromChain: {
        metamask: { blockExplorerUrls: ['https://mempool.space/'] },
      },
      checkClient: vi.fn(),
    } as unknown as BitcoinStepExecutorContext

    const outcome = await executor
      .createPipeline(context)
      .run(context)
      .catch((error: unknown) => error)

    expect(outcome).toBe(stopAfterWait)
    expect(signPsbt).toHaveBeenCalledTimes(1)
    // Within the age cap: only the sign task's flag stops a resend.
    expect(context.step.execution?.signedAt).toBe(NOW)
    expect(context.bitcoinSent).toBe(true)
    const sends = request.mock.calls.filter(
      ([args]) => (args as { method: string }).method === 'sendrawtransaction'
    )
    expect(sends).toEqual([
      [{ method: 'sendrawtransaction', params: [TX_HEX] }, { retryCount: 0 }],
    ])
    expect(sendUTXOTransaction).not.toHaveBeenCalled()
    expect(waitForTransaction).toHaveBeenCalledTimes(1)
    expect(waitForTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ txId: TX_HASH, txHex: TX_HEX })
    )
  })
})
