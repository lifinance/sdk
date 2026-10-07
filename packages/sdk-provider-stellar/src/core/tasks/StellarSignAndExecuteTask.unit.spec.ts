import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSignedTransaction,
  coveringNotFound,
  keypair,
  MAX_TIME,
  MIN_TIME,
  NETWORK,
  rejection,
} from './helpers/classifySubmitFailure.unit.mock.js'

const getTransactionRequestData = vi.fn()
const isKnownToStatusApi = vi.fn()
vi.mock('@lifi/sdk', async () => {
  const actual = await vi.importActual<typeof import('@lifi/sdk')>('@lifi/sdk')
  return {
    ...actual,
    getTransactionRequestData: (...args: unknown[]) =>
      getTransactionRequestData(...args),
    isKnownToStatusApi: (...args: unknown[]) => isKnownToStatusApi(...args),
  }
})

const submitStellarTransaction = vi.fn()
vi.mock('./helpers/submitStellarTransaction.js', () => ({
  submitStellarTransaction: (...args: unknown[]) =>
    submitStellarTransaction(...args),
  waitForStellarTransaction: vi.fn(),
}))

// The absence proof reads every RPC; only the transport is replaced.
const getTransaction = vi.fn()
vi.mock('../../client/getStellarRpc.js', () => ({
  getStellarRpcs: async () => [{ getTransaction }],
}))

const { StellarSignAndExecuteTask } = await import(
  './StellarSignAndExecuteTask.js'
)
const { isFinalTransactionError, LiFiErrorCode, StatusManager } = await import(
  '@lifi/sdk'
)

const makeContext = (
  signedTxXdr: string,
  onUpdateAction?: () => void,
  action: Record<string, unknown> = { type: 'SWAP' }
): {
  context: never
  updateAction: ReturnType<typeof vi.fn>
  signTransaction: ReturnType<typeof vi.fn>
} => {
  const updateAction = vi.fn()
  const signTransaction = vi.fn().mockResolvedValue({ signedTxXdr })
  return {
    updateAction,
    signTransaction,
    context: {
      client: {},
      wallet: { address: keypair.publicKey(), signTransaction },
      fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
      networkPassphrase: NETWORK,
      isBridgeExecution: false,
      checkWallet: () => {},
      step: { action: { fromAddress: keypair.publicKey() } },
      statusManager: {
        findAction: () => action,
        updateAction: (...args: unknown[]) => {
          onUpdateAction?.()
          updateAction(...args)
        },
      },
    } as never,
  }
}

describe('StellarSignAndExecuteTask', () => {
  beforeEach(() => {
    getTransactionRequestData.mockReset().mockResolvedValue('UNSIGNED_XDR')
    submitStellarTransaction.mockReset().mockResolvedValue('network-hash')
  })

  it('derives the hash from the signed envelope rather than the submit response', async () => {
    const transaction = buildSignedTransaction()
    const expectedHash = Buffer.from(transaction.hash()).toString('hex')
    const signedTxXdr = transaction.toXdr()
    const { context, updateAction } = makeContext(signedTxXdr)

    const result = await new StellarSignAndExecuteTask().run(context)

    expect(result.context).toEqual({ transactionHash: expectedHash })
    expect(updateAction).toHaveBeenCalledWith(
      expect.anything(),
      'SWAP',
      'PENDING',
      expect.objectContaining({
        txHash: expectedHash,
        txLink: `https://explorer/tx/${expectedHash}`,
        txHex: signedTxXdr,
      })
    )
  })

  it('persists the hash BEFORE submitting, so a crash resumes by polling instead of re-signing', async () => {
    const order: string[] = []
    submitStellarTransaction.mockImplementation(async () => {
      order.push('submit')
      return 'network-hash'
    })
    const { context } = makeContext(buildSignedTransaction().toXdr(), () =>
      order.push('updateAction')
    )

    await new StellarSignAndExecuteTask().run(context)

    expect(order).toEqual(['updateAction', 'submit'])
  })

  it('signs the payload returned by getTransactionRequestData', async () => {
    const { context, signTransaction } = makeContext(
      buildSignedTransaction().toXdr()
    )

    await new StellarSignAndExecuteTask().run(context)

    expect(signTransaction).toHaveBeenCalledWith('UNSIGNED_XDR', {
      address: keypair.publicKey(),
      networkPassphrase: NETWORK,
    })
  })
})

describe('StellarSignAndExecuteTask submit rejection (first run)', () => {
  const runWithRejection = async (
    error: unknown
  ): Promise<{ thrown: unknown; expectedHash: string }> => {
    const transaction = buildSignedTransaction({
      minTime: MIN_TIME,
      maxTime: MAX_TIME,
    })
    submitStellarTransaction.mockRejectedValue(error)
    const { context } = makeContext(transaction.toXdr())
    const thrown = await new StellarSignAndExecuteTask()
      .run(context)
      .catch((caught: unknown) => caught)
    return {
      thrown,
      expectedHash: Buffer.from(transaction.hash()).toString('hex'),
    }
  }

  beforeEach(() => {
    getTransactionRequestData.mockReset().mockResolvedValue('UNSIGNED_XDR')
    submitStellarTransaction.mockReset()
    getTransaction.mockReset().mockResolvedValue(coveringNotFound())
    isKnownToStatusApi.mockReset().mockResolvedValue(false)
  })

  it('is final for a covering NOT_FOUND past the head that the status API does not know', async () => {
    const { thrown, expectedHash } = await runWithRejection(rejection())

    expect(thrown).toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Stellar transaction submission failed: txBadSeq',
      final: true,
    })
    expect(getTransaction).toHaveBeenCalledWith(expectedHash)
    expect(isKnownToStatusApi).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expectedHash
    )
  })

  it('stays unknown when oldestLedgerCloseTime is after the anchor', async () => {
    getTransaction.mockResolvedValue(
      coveringNotFound({ oldestLedgerCloseTime: MIN_TIME + 60 })
    )
    const error = rejection()

    const { thrown } = await runWithRejection(error)

    expect(thrown).toBe(error)
    expect(thrown).toMatchObject({ final: false })
  })

  it('stays unknown when isKnownToStatusApi is true', async () => {
    isKnownToStatusApi.mockResolvedValue(true)
    const error = rejection()

    const { thrown } = await runWithRejection(error)

    expect(thrown).toBe(error)
    expect(thrown).toMatchObject({ final: false })
  })

  it('does not look anything up after a transport failure', async () => {
    const transport = new AggregateError(
      [new Error('503')],
      'All 2 Stellar RPCs failed'
    )

    const { thrown } = await runWithRejection(transport)

    expect(thrown).toBe(transport)
    expect(isFinalTransactionError(thrown)).toBe(false)
    expect(getTransaction).not.toHaveBeenCalled()
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })
})

describe('StellarSignAndExecuteTask pre-sign guard', () => {
  beforeEach(() => {
    getTransactionRequestData.mockReset().mockResolvedValue('UNSIGNED_XDR')
    submitStellarTransaction.mockReset().mockResolvedValue('network-hash')
  })

  it.each([
    [
      'a pending hash',
      { type: 'SWAP', status: 'PENDING', txHash: 'h', txHex: 'XDR' },
    ],
    [
      'a FAILED hash without txFinal',
      { type: 'SWAP', status: 'FAILED', txHash: 'h', txHex: 'XDR' },
    ],
    ['stored bytes only', { type: 'SWAP', status: 'PENDING', txHex: 'XDR' }],
  ])(
    'throws TransactionConflict and never opens the wallet for %s',
    async (_label, action) => {
      const { context, signTransaction, updateAction } = makeContext(
        buildSignedTransaction().toXdr(),
        undefined,
        action
      )

      await expect(
        new StellarSignAndExecuteTask().run(context)
      ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })
      expect(signTransaction).not.toHaveBeenCalled()
      expect(getTransactionRequestData).not.toHaveBeenCalled()
      expect(submitStellarTransaction).not.toHaveBeenCalled()
      expect(updateAction).not.toHaveBeenCalled()
    }
  )

  // An older run's late write can merge its transaction into this action
  // while the task awaits the quote.
  it('checks the action again right before the wallet and never opens it when a transaction merged meanwhile', async () => {
    const { context, signTransaction, updateAction } = makeContext(
      buildSignedTransaction().toXdr(),
      undefined,
      { type: 'SWAP', status: 'STARTED' }
    )
    const { statusManager } = context as {
      statusManager: { findAction: () => unknown }
    }
    getTransactionRequestData.mockImplementationOnce(async () => {
      statusManager.findAction = () => ({
        type: 'SWAP',
        status: 'PENDING',
        txHash: 'h',
        txHex: 'XDR',
      })
      return 'UNSIGNED_XDR'
    })

    await expect(
      new StellarSignAndExecuteTask().run(context)
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })
    expect(getTransactionRequestData).toHaveBeenCalledTimes(1)
    expect(signTransaction).not.toHaveBeenCalled()
    expect(submitStellarTransaction).not.toHaveBeenCalled()
    expect(updateAction).not.toHaveBeenCalled()
  })

  // A stop during this run's prompt, then a resume: the older run signs, and
  // its late write merges its transaction into this action while this
  // prompt is still open.
  it('checks the action again after the wallet and neither stores nor submits when a transaction merged while the prompt was open', async () => {
    const signedTxXdr = buildSignedTransaction().toXdr()
    const { context, signTransaction } = makeContext(signedTxXdr)
    // A real manager. Without route state, `allowUpdates(false)` keeps every
    // write on the step.
    const statusManager = new StatusManager('route-1')
    statusManager.allowUpdates(false)
    const step = {
      action: { fromAddress: keypair.publicKey() },
      execution: {
        status: 'PENDING',
        actions: [{ type: 'SWAP', status: 'STARTED' }],
      },
    }
    const merged = {
      txHash: 'merged-hash',
      txLink: 'https://explorer/tx/merged-hash',
      txHex: 'MERGED_XDR',
    }
    signTransaction.mockImplementationOnce(async () => {
      statusManager.updateAction(step as never, 'SWAP', 'PENDING', {
        ...merged,
        signedAt: 1_700_000_000_000,
      })
      return { signedTxXdr }
    })
    const writes = vi.spyOn(statusManager, 'updateAction')

    await expect(
      new StellarSignAndExecuteTask().run({
        ...(context as object),
        step,
        statusManager,
      } as never)
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })

    expect(signTransaction).toHaveBeenCalledTimes(1)
    expect(submitStellarTransaction).not.toHaveBeenCalled()
    // Only the merge: no envelope of this run.
    expect(writes).toHaveBeenCalledTimes(1)
    expect(step.execution.actions).toEqual([
      expect.objectContaining({ type: 'SWAP', ...merged }),
    ])
    expect(step.execution).toMatchObject({ signedAt: 1_700_000_000_000 })
  })

  it('signs again after a final outcome and clears the old transaction fields', async () => {
    const transaction = buildSignedTransaction()
    const expectedHash = Buffer.from(transaction.hash()).toString('hex')
    const { context, signTransaction, updateAction } = makeContext(
      transaction.toXdr(),
      undefined,
      {
        type: 'SWAP',
        status: 'FAILED',
        txHash: 'old-hash',
        txHex: 'OLD_XDR',
        txFinal: true,
      }
    )

    await new StellarSignAndExecuteTask().run(context)

    expect(signTransaction).toHaveBeenCalledTimes(1)
    const params = updateAction.mock.calls.find(
      ([, , status]) => status === 'PENDING'
    )?.[3] as Record<string, unknown>
    expect(Object.keys(params)).toEqual(
      expect.arrayContaining(['txHash', 'txLink', 'txHex', 'txFinal', 'taskId'])
    )
    expect(params).toMatchObject({
      txHash: expectedHash,
      txHex: transaction.toXdr(),
    })
    // `toMatchObject` ignores `undefined` values, so the cleared keys are
    // checked one by one.
    expect('txFinal' in params).toBe(true)
    expect(params.txFinal).toBeUndefined()
    expect('taskId' in params).toBe(true)
    expect(params.taskId).toBeUndefined()
  })
})
