import {
  CLOCK_SKEW_MARGIN_MS,
  isFinalTransactionError,
  LiFiErrorCode,
  TransactionError,
} from '@lifi/sdk'
import { rpc } from '@stellar/stellar-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSignedTransaction,
  coveringNotFound,
  MAX_TIME,
  MIN_TIME,
  NETWORK,
  rejection,
} from './classifySubmitFailure.unit.mock.js'

const isKnownToStatusApi = vi.fn()
vi.mock('@lifi/sdk', async () => {
  const actual = await vi.importActual<typeof import('@lifi/sdk')>('@lifi/sdk')
  return {
    ...actual,
    isKnownToStatusApi: (...args: unknown[]) => isKnownToStatusApi(...args),
  }
})

const getTransaction = vi.fn()
vi.mock('../../../client/getStellarRpc.js', () => ({
  getStellarRpcs: async () => [{ getTransaction }],
}))

const { classifySubmitFailure } = await import('./classifySubmitFailure.js')

const HASH = 'ab'.repeat(32)
const SKEW_SECONDS = CLOCK_SKEW_MARGIN_MS / 1000

const envelope = (timebounds: { minTime: number; maxTime: number }): string =>
  buildSignedTransaction(timebounds).toXdr()

const client = {} as never

const classify = (
  error: unknown,
  options: { signedTxXdr?: string; signedAt?: number } = {}
): Promise<unknown> =>
  classifySubmitFailure(
    {
      client,
      step: {
        id: 'step-1',
        execution: {
          status: 'FAILED',
          startedAt: 0,
          actions: [],
          signedAt: options.signedAt,
        },
      } as never,
      transactionHash: HASH,
      signedTxXdr:
        options.signedTxXdr ??
        envelope({ minTime: MIN_TIME, maxTime: MAX_TIME }),
      networkPassphrase: NETWORK,
    },
    error
  )

describe('classifySubmitFailure', () => {
  beforeEach(() => {
    getTransaction.mockReset().mockResolvedValue(coveringNotFound())
    isKnownToStatusApi.mockReset().mockResolvedValue(false)
  })

  it('is final for a covering NOT_FOUND past the head that the status API does not know', async () => {
    const error = rejection()

    const result = await classify(error)

    expect(result).toBeInstanceOf(TransactionError)
    expect(result).toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Stellar transaction submission failed: txBadSeq',
      final: true,
    })
    expect((result as TransactionError).cause).toBe(error)
    expect(getTransaction).toHaveBeenCalledWith(HASH)
    expect(isKnownToStatusApi).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ id: 'step-1' }),
      HASH
    )
  })

  it('is not final when oldestLedgerCloseTime is after the anchor', async () => {
    getTransaction.mockResolvedValue(
      coveringNotFound({ oldestLedgerCloseTime: MIN_TIME + 60 })
    )
    const error = rejection()

    const result = await classify(error)

    expect(result).toBe(error)
    expect(isFinalTransactionError(result)).toBe(false)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
  })

  it('is not final while the latest ledger is not past maxTime plus the margin', async () => {
    getTransaction.mockResolvedValue(
      coveringNotFound({ latestLedgerCloseTime: MAX_TIME + 10 })
    )
    const error = rejection()

    await expect(classify(error)).resolves.toBe(error)
  })

  // Veto only: the status API knows the hash, so the outcome is never final.
  it('is not final when isKnownToStatusApi is true', async () => {
    isKnownToStatusApi.mockResolvedValue(true)
    const error = rejection()

    const result = await classify(error)

    expect(result).toBe(error)
    expect(isFinalTransactionError(result)).toBe(false)
  })

  it('is not final when a node returns the transaction', async () => {
    getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      txHash: HASH,
    })
    const error = rejection()

    await expect(classify(error)).resolves.toBe(error)
  })

  it('anchors on signedAt minus CLOCK_SKEW_MARGIN_MS when the envelope has no minTime', async () => {
    const signedTxXdr = envelope({ minTime: 0, maxTime: MAX_TIME })
    const signedAt = MIN_TIME * 1000
    const error = rejection()

    getTransaction.mockResolvedValue(
      coveringNotFound({ oldestLedgerCloseTime: MIN_TIME - SKEW_SECONDS - 1 })
    )
    await expect(
      classify(error, { signedTxXdr, signedAt })
    ).resolves.toMatchObject({ final: true })

    // Covers the signing time but not the skew margin before it.
    getTransaction.mockResolvedValue(
      coveringNotFound({ oldestLedgerCloseTime: MIN_TIME - SKEW_SECONDS })
    )
    await expect(classify(error, { signedTxXdr, signedAt })).resolves.toBe(
      error
    )
  })

  it('is not final without an anchor (no minTime, no signedAt)', async () => {
    const error = rejection()

    await expect(
      classify(error, {
        signedTxXdr: envelope({ minTime: 0, maxTime: MAX_TIME }),
      })
    ).resolves.toBe(error)
    expect(getTransaction).not.toHaveBeenCalled()
  })

  it('is not final for an envelope without maxTime (it never expires)', async () => {
    const error = rejection()

    await expect(
      classify(error, {
        signedTxXdr: envelope({ minTime: MIN_TIME, maxTime: 0 }),
      })
    ).resolves.toBe(error)
    expect(getTransaction).not.toHaveBeenCalled()
  })

  it('is not final for an envelope that does not decode', async () => {
    const error = rejection()

    await expect(classify(error, { signedTxXdr: 'not-xdr' })).resolves.toBe(
      error
    )
    expect(getTransaction).not.toHaveBeenCalled()
  })

  it.each([
    [
      'a transport failure',
      new AggregateError([new Error('503')], 'All 2 Stellar RPCs failed'),
    ],
    [
      'an exhausted TRY_AGAIN_LATER',
      new TransactionError(
        LiFiErrorCode.RateLimitExceeded,
        'Stellar RPC asked to try again later.'
      ),
    ],
    ['a decode error', new Error('invalid XDR')],
  ])(
    'returns %s unchanged without asking the network',
    async (_label, error) => {
      const result = await classify(error)

      expect(result).toBe(error)
      expect(isFinalTransactionError(result)).toBe(false)
      expect(getTransaction).not.toHaveBeenCalled()
      expect(isKnownToStatusApi).not.toHaveBeenCalled()
    }
  )
})
