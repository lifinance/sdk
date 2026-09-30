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
const { isFinalTransactionError, LiFiErrorCode } = await import('@lifi/sdk')

const makeContext = (
  signedTxXdr: string,
  onUpdateAction?: () => void
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
        findAction: () => ({ type: 'SWAP' }),
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
