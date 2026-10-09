import {
  CLEARED_TRANSACTION_FIELDS,
  type ExecutionAction,
  hasOpenTransaction,
  isFinalTransactionError,
  LiFiErrorCode,
  type LiFiStepExtended,
  type StatusManager,
  TransactionError,
} from '@lifi/sdk'
import { type Hash, UnknownBundleIdError } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../actions/waitForBatchTransactionReceipt.js', () => ({
  waitForBatchTransactionReceipt: vi.fn(),
}))

import { waitForBatchTransactionReceipt } from '../../actions/waitForBatchTransactionReceipt.js'
import { CallBundleDroppedError } from '../../errors/CallBundleDroppedError.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumBatchedWaitForTransactionTask } from './EthereumBatchedWaitForTransactionTask.js'

const BUNDLE_ID: Hash = `0x${'b1'.repeat(32)}`
const SIGNED_AT = 1_700_000_000_000

const unknownBundle = (): UnknownBundleIdError =>
  new UnknownBundleIdError(new Error('No matching bundle found'))

/**
 * A SWAP action that waits for a single-call bundle, unless `fields` say
 * otherwise, and a status manager that writes into it, so the test reads
 * the action as the step executor leaves it.
 */
const buildContext = (
  fields: Partial<ExecutionAction> = {}
): {
  context: EthereumStepExecutorContext
  statusManager: StatusManager
  action: ExecutionAction
  client: object
} => {
  const action: ExecutionAction = {
    type: 'SWAP',
    status: 'PENDING',
    taskId: BUNDLE_ID,
    txType: 'batched',
    callCount: 1,
    ...fields,
  }
  const statusManager = {
    findAction: vi.fn(() => action),
    updateAction: vi.fn(
      (
        _step: LiFiStepExtended,
        _type: string,
        status: ExecutionAction['status'],
        params?: Partial<ExecutionAction>
      ) => Object.assign(action, { status }, params)
    ),
  } as unknown as StatusManager
  const client = {}
  const context = {
    step: {
      id: 'batched-step',
      action: { fromChainId: 137, toChainId: 137 },
      execution: {
        status: 'PENDING',
        signedAt: SIGNED_AT,
        actions: [action],
      },
    } as unknown as LiFiStepExtended,
    statusManager,
    fromChain: { id: 137 },
    isBridgeExecution: false,
    checkClient: vi.fn(async () => client),
  } as unknown as EthereumStepExecutorContext
  return { context, statusManager, action, client }
}

/** The action as the step executor leaves it after a non-final error. */
const failed = (action: ExecutionAction): ExecutionAction => ({
  ...action,
  status: 'FAILED',
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EthereumBatchedWaitForTransactionTask: a bundle the wallet does not know', () => {
  // The stored count, not the calls of the context: after a reload the
  // context has no calls.
  it.each([{ callCount: 1 }, { callCount: 2 }, { callCount: undefined }])(
    'passes the signing time of the step and the call count $callCount of the action to the wait',
    async ({ callCount }) => {
      const { context, client } = buildContext({ callCount })
      vi.mocked(waitForBatchTransactionReceipt).mockResolvedValue({
        status: 'success',
      } as never)

      await new EthereumBatchedWaitForTransactionTask().run(context)

      expect(waitForBatchTransactionReceipt).toHaveBeenCalledWith(
        client,
        BUNDLE_ID,
        expect.any(Function),
        SIGNED_AT,
        callCount
      )
    }
  )

  // The bundle never left the wallet: the action must look as after a
  // rejection before sending, so "Try again" signs anew.
  it('clears the transaction of a dropped bundle and fails with SignatureRejected', async () => {
    const { context, statusManager, action } = buildContext()
    const dropped = new CallBundleDroppedError(unknownBundle())
    vi.mocked(waitForBatchTransactionReceipt).mockRejectedValue(dropped)

    const error = await new EthereumBatchedWaitForTransactionTask()
      .run(context)
      .catch((error: unknown) => error)

    expect(error).toBeInstanceOf(TransactionError)
    expect(error).toMatchObject({
      code: LiFiErrorCode.SignatureRejected,
      message: 'The wallet dropped the call bundle before it sent it.',
    })
    expect((error as Error).cause).toBe(dropped)
    expect(isFinalTransactionError(error)).toBe(false)
    expect(statusManager.updateAction).toHaveBeenCalledTimes(1)
    const [step, type, status, fields] = vi.mocked(statusManager.updateAction)
      .mock.calls[0]
    expect([step, type, status]).toEqual([context.step, 'SWAP', 'PENDING'])
    // Strict: a missing key would leave that field of the bundle in place.
    expect(fields).toStrictEqual({
      ...CLEARED_TRANSACTION_FIELDS,
      txType: undefined,
    })
    expect(action.taskId).toBeUndefined()
    expect(action.txType).toBeUndefined()
    expect(action.callCount).toBeUndefined()
    expect(hasOpenTransaction(failed(action))).toBe(false)
  })

  it('keeps the bundle of an unknown outcome and rethrows CallBundleNotFound', async () => {
    const { context, statusManager, action } = buildContext()
    const notFound = new TransactionError(
      LiFiErrorCode.CallBundleNotFound,
      'The wallet has no record of the call bundle.',
      unknownBundle()
    )
    vi.mocked(waitForBatchTransactionReceipt).mockRejectedValue(notFound)

    await expect(
      new EthereumBatchedWaitForTransactionTask().run(context)
    ).rejects.toBe(notFound)

    expect(statusManager.updateAction).not.toHaveBeenCalled()
    expect(action.taskId).toBe(BUNDLE_ID)
    expect(hasOpenTransaction(failed(action))).toBe(true)
  })

  it('rethrows any other error of the wait unchanged and writes nothing', async () => {
    const { context, statusManager, action } = buildContext()
    const walletError = new Error('wallet_getCallsStatus timed out')
    vi.mocked(waitForBatchTransactionReceipt).mockRejectedValue(walletError)

    await expect(
      new EthereumBatchedWaitForTransactionTask().run(context)
    ).rejects.toBe(walletError)

    expect(statusManager.updateAction).not.toHaveBeenCalled()
    expect(hasOpenTransaction(failed(action))).toBe(true)
  })
})
