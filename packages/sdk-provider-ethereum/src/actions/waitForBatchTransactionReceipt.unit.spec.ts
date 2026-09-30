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

  it('marks a successful batch without receipts as a final failure', async () => {
    const client = clientReturning({
      status: 'success',
      statusCode: 200,
      receipts: [],
    })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction was reverted.',
      final: true,
    })
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

  it('marks a failed batch (5xx) as a final failure', async () => {
    const client = clientReturning({ status: 'failure', statusCode: 500 })

    await expect(
      waitForBatchTransactionReceipt(client, BATCH_ID)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction failed.',
      final: true,
    })
  })

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
