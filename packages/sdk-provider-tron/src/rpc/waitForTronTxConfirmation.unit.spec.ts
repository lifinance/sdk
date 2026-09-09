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

// Verbatim `gettransactioninfobyid` response for the failed TRC-20 approval from
// TECHSUP-166. Tron signals failure with the top-level `result: 'FAILED'` and
// puts the reason in `receipt.result`; `receipt.result` is never 'FAILED' itself.
const OUT_OF_ENERGY_APPROVAL_TX_INFO = {
  id: 'e28be0cfff1142585be695b1a17aee0844208ad5cef8000a02cf9ad203d680d9',
  fee: 400800,
  blockNumber: 86010320,
  blockTimeStamp: 1788702714000,
  contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
  receipt: {
    energy_fee: 400800,
    energy_usage_total: 4008,
    net_usage: 345,
    result: 'OUT_OF_ENERGY',
    energy_penalty_total: 2513,
  },
  result: 'FAILED',
  resMessage:
    '4e6f7420656e6f75676820656e6572677920666f7220275353544f524527206f7065726174696f6e20657865637574696e673a20637572496e766f6b65456e657267794c696d69745b343030385d2c206375724f70456e657267794c696d69745b353030305d2c2070656e616c7479456e657267795b31373030305d2c2075736564456e657267795b333236345d',
}

describe('waitForTronTxConfirmation', () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('resolves when the receipt reports SUCCESS', async () => {
    // A successful transaction carries no top-level `result` field.
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue({
      id: TX_HASH,
      receipt: { result: 'SUCCESS' },
    })

    await expect(
      waitForTronTxConfirmation(client, TX_HASH)
    ).resolves.toBeUndefined()
  })

  it('resolves when the receipt has no contract result (plain TRX transfer)', async () => {
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue({
      id: TX_HASH,
      receipt: { net_usage: 268 },
    })

    await expect(
      waitForTronTxConfirmation(client, TX_HASH)
    ).resolves.toBeUndefined()
  })

  it('rejects with InsufficientFunds for the OUT_OF_ENERGY approval from TECHSUP-166', async () => {
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue(
      OUT_OF_ENERGY_APPROVAL_TX_INFO
    )

    await expect(
      waitForTronTxConfirmation(
        client,
        TX_HASH,
        'Approval transaction failed on-chain'
      )
    ).rejects.toMatchObject({
      code: LiFiErrorCode.InsufficientFunds,
      message: expect.stringContaining('OUT_OF_ENERGY'),
    })
  })

  it('names TRX in the OUT_OF_ENERGY error message', async () => {
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue(
      OUT_OF_ENERGY_APPROVAL_TX_INFO
    )

    await expect(waitForTronTxConfirmation(client, TX_HASH)).rejects.toThrow(
      /TRX/
    )
  })

  it('rejects with TransactionError(TransactionFailed) when the top-level result is FAILED', async () => {
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue({
      id: TX_HASH,
      result: 'FAILED',
      receipt: { result: 'REVERT' },
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

  it('appends the receipt reason to the custom onChainFailureMessage', async () => {
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue({
      id: TX_HASH,
      result: 'FAILED',
      receipt: { result: 'REVERT' },
    })

    await expect(
      waitForTronTxConfirmation(
        client,
        TX_HASH,
        'Approval transaction failed on-chain'
      )
    ).rejects.toThrow('Approval transaction failed on-chain: REVERT.')
  })

  it('uses the default message when a FAILED result carries no receipt reason', async () => {
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue({
      id: TX_HASH,
      result: 'FAILED',
      receipt: {},
    })

    await expect(waitForTronTxConfirmation(client, TX_HASH)).rejects.toThrow(
      'Transaction failed on-chain.'
    )
  })

  it('rejects when the receipt reports a contract failure without a top-level result', async () => {
    // Defense in depth: a node or proxy that drops the top-level `result`
    // field must not turn a reverted transaction into a confirmation.
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue({
      id: TX_HASH,
      receipt: { result: 'OUT_OF_TIME' },
    })

    await expect(
      waitForTronTxConfirmation(client, TX_HASH)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: expect.stringContaining('OUT_OF_TIME'),
    })
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

  it('does not retry an on-chain failure (the result is final)', async () => {
    vi.mocked(callTronRpcsWithRetry).mockResolvedValue(
      OUT_OF_ENERGY_APPROVAL_TX_INFO
    )

    await expect(
      waitForTronTxConfirmation(client, TX_HASH)
    ).rejects.toBeInstanceOf(TransactionError)

    // Should have polled exactly once — the FAILED result is not retried.
    expect(vi.mocked(callTronRpcsWithRetry)).toHaveBeenCalledTimes(1)
  })
})
