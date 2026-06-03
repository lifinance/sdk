import type { SDKClient } from '@lifi/sdk'
import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { callTronRpcsWithRetry } from './callTronRpcsWithRetry.js'
import { waitForTronTxConfirmation } from './waitForTronTxConfirmation.js'

// Trim poll budget and interval so tests run fast and time out deterministically.
vi.mock('../core/constants.js', () => ({
  TRON_POLL_INTERVAL_MS: 0,
  TRON_POLL_MAX_POLLS: 3,
  TRON_POLL_MAX_ERROR_RETRIES: 2,
}))

vi.mock('./callTronRpcsWithRetry.js', () => ({
  callTronRpcsWithRetry: vi.fn(),
}))

const client = {} as SDKClient
const TX_HASH = 'abc123def456'

describe('waitForTronTxConfirmation', () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('resolves when the transaction is confirmed', async () => {
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue({
      id: TX_HASH,
      receipt: { result: 'SUCCESS' },
    })

    await expect(
      waitForTronTxConfirmation(client, TX_HASH)
    ).resolves.toBeUndefined()
  })

  it('throws TransactionError(TransactionFailed) when the receipt is FAILED', async () => {
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue({
      id: TX_HASH,
      receipt: { result: 'FAILED' },
    })

    await expect(
      waitForTronTxConfirmation(client, TX_HASH)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
    })

    await expect(
      waitForTronTxConfirmation(client, TX_HASH)
    ).rejects.toBeInstanceOf(TransactionError)
  })

  it('uses the custom onChainFailureMessage when the receipt is FAILED', async () => {
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue({
      id: TX_HASH,
      receipt: { result: 'FAILED' },
    })

    await expect(
      waitForTronTxConfirmation(
        client,
        TX_HASH,
        'Approval transaction failed on-chain.'
      )
    ).rejects.toThrow('Approval transaction failed on-chain.')
  })

  it('times out after TRON_POLL_MAX_POLLS polls when the transaction is never indexed', async () => {
    // Return a response with no `id` so the transaction appears un-indexed.
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue({})

    await expect(waitForTronTxConfirmation(client, TX_HASH)).rejects.toThrow(
      'Transaction confirmation timeout.'
    )
  })

  it('tolerates a transient RPC error and resolves on the next poll', async () => {
    // waitForResult throws when attempts === maxRetries (2), so it tolerates
    // maxRetries-1 = 1 error before giving up. One error then success should resolve.
    vi.mocked(callTronRpcsWithRetry)
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValue({ id: TX_HASH, receipt: {} })

    await expect(
      waitForTronTxConfirmation(client, TX_HASH)
    ).resolves.toBeUndefined()
  })

  it('does not retry a TransactionError (on-chain failure is final)', async () => {
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue({
      id: TX_HASH,
      receipt: { result: 'FAILED' },
    })

    await expect(
      waitForTronTxConfirmation(client, TX_HASH)
    ).rejects.toBeInstanceOf(TransactionError)

    // Should have polled exactly once — the FAILED result is not retried.
    expect(vi.mocked(callTronRpcsWithRetry)).toHaveBeenCalledTimes(1)
  })
})
