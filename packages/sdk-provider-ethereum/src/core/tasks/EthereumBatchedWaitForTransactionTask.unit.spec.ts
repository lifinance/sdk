import {
  type ExecutionAction,
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EthereumBatchedWaitForTransactionTask: a bundle the wallet does not know', () => {
  // The stored count, not the calls of the context: after a reload the
  // context has no calls.
  it('passes the signing time of the step and the call count of the action to the wait', async () => {
    const { context, client } = buildContext({ callCount: 2 })
    vi.mocked(waitForBatchTransactionReceipt).mockResolvedValue({
      status: 'success',
    } as never)

    await new EthereumBatchedWaitForTransactionTask().run(context)

    expect(waitForBatchTransactionReceipt).toHaveBeenCalledWith(
      client,
      BUNDLE_ID,
      { onFailed: expect.any(Function), signedAt: SIGNED_AT, callCount: 2 }
    )
  })

  // The task writes nothing on an error: the step executor stores it. A
  // final rejection closes the action with `txFinal`, and "Try again" signs
  // anew. Any other error keeps the bundle open.
  it.each([
    {
      error: 'a final rejection',
      thrown: (): Error =>
        new TransactionError(
          LiFiErrorCode.SignatureRejected,
          'The wallet removed the call bundle before it sent it.',
          unknownBundle(),
          { final: true }
        ),
    },
    {
      error: 'CallBundleNotFound',
      thrown: (): Error =>
        new TransactionError(
          LiFiErrorCode.CallBundleNotFound,
          'The wallet has no record of the call bundle.',
          unknownBundle()
        ),
    },
    {
      error: 'a wallet error',
      thrown: (): Error => new Error('wallet_getCallsStatus timed out'),
    },
  ])(
    'rethrows $error of the wait unchanged and writes nothing',
    async ({ thrown }) => {
      const { context, statusManager, action } = buildContext()
      const error = thrown()
      vi.mocked(waitForBatchTransactionReceipt).mockRejectedValue(error)

      await expect(
        new EthereumBatchedWaitForTransactionTask().run(context)
      ).rejects.toBe(error)

      expect(statusManager.updateAction).not.toHaveBeenCalled()
      expect(action).toMatchObject({
        taskId: BUNDLE_ID,
        txType: 'batched',
        callCount: 1,
      })
    }
  )
})
