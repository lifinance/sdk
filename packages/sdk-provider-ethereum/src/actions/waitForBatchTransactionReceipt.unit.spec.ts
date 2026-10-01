import { isFinalTransactionError, LiFiErrorCode } from '@lifi/sdk'
import type { Client, Hash } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { waitForBatchTransactionReceipt } from './waitForBatchTransactionReceipt.js'

const BATCH_ID = `0x${'ba'.repeat(32)}` as Hash
const TX_HASH = `0x${'ab'.repeat(32)}` as Hash

/**
 * `getAction` prefers a method of the same name on the client — the seam the
 * flow harness uses as well — so no `vi.mock('viem/actions')` is needed.
 */
const clientReturning = (result: Record<string, unknown>): Client =>
  ({
    waitForCallsStatus: vi.fn().mockResolvedValue(result),
  }) as unknown as Client

describe('waitForBatchTransactionReceipt', () => {
  it('marks a batch with a reverted call as a final failure', async () => {
    const onFailed = vi.fn()
    const client = clientReturning({
      status: 'success',
      statusCode: 200,
      receipts: [{ status: 'reverted', transactionHash: TX_HASH }],
    })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID, onFailed)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction was reverted.',
      final: true,
    })
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  // Status 200 means the wallet reports the batch as executed. Without a
  // complete set of receipts that proves nothing: the outcome stays unknown.
  it('leaves a successful batch without receipts unknown', async () => {
    const onFailed = vi.fn()
    const client = clientReturning({
      status: 'success',
      statusCode: 200,
      receipts: [],
    })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID, onFailed)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction was reverted.',
      final: false,
    })
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  it('leaves a successful batch with a receipt without a hash unknown', async () => {
    const onFailed = vi.fn()
    const client = clientReturning({
      status: 'success',
      statusCode: 200,
      receipts: [
        { status: 'success', transactionHash: TX_HASH },
        { status: 'success' },
      ],
    })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID, onFailed)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction was reverted.',
      final: false,
    })
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  it('marks a batch the wallet did not include (4xx) as a final failure', async () => {
    const client = clientReturning({ status: 'failure', statusCode: 400 })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionCanceled,
      message: 'Transaction was canceled.',
      final: true,
    })
  })

  it('marks a batch that reverted completely (500) as a final failure', async () => {
    const onFailed = vi.fn()
    const client = clientReturning({ status: 'failure', statusCode: 500 })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID, onFailed)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction failed.',
      final: true,
    })
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  // Some calls of a partial batch may be onchain.
  it('leaves a partially reverted batch (600) unknown', async () => {
    const onFailed = vi.fn()
    const client = clientReturning({ status: 'failure', statusCode: 600 })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID, onFailed)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction failed.',
      final: false,
    })
    expect(onFailed).toHaveBeenCalledTimes(1)
  })

  // viem maps 300–699 to `failure` and leaves codes from 700 without a status.
  it.each([
    { status: 'failure', statusCode: 300 },
    { status: 'failure', statusCode: 501 },
    { status: undefined, statusCode: 700 },
  ])(
    'leaves a batch with the undefined code $statusCode unknown',
    async (result) => {
      const onFailed = vi.fn()
      const client = clientReturning(result)

      await expect(
        waitForBatchTransactionReceipt(client, BATCH_ID, onFailed)
      ).rejects.toMatchObject({
        code: LiFiErrorCode.TransactionFailed,
        message: 'Transaction failed.',
        final: false,
      })
      expect(onFailed).toHaveBeenCalledTimes(1)
    }
  )

  it('leaves a wallet error unknown', async () => {
    const walletError = new Error('wallet_getCallsStatus timed out')
    const client = {
      waitForCallsStatus: vi.fn().mockRejectedValue(walletError),
    } as unknown as Client

    const thrown = await waitForBatchTransactionReceipt(client, BATCH_ID).catch(
      (error: unknown) => error
    )

    expect(thrown).toBe(walletError)
    expect(isFinalTransactionError(thrown)).toBe(false)
  })
})
