import { LiFiErrorCode, type SDKClient, waitForResult } from '@lifi/sdk'
import type { Address, Hash, Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  // Real polling by default. One test replaces a single call to reach the
  // timeout branch, which real polling cannot reach (see the editor notes).
  return { ...actual, waitForResult: vi.fn(actual.waitForResult) }
})

vi.mock('../client/safeClient.js', () => ({
  getSafeClient: vi.fn(),
}))

import {
  getSafeClient,
  type SafeClientInterface,
} from '../client/safeClient.js'
import { waitForSafeTransactionExecution } from './waitForSafeTransactionExecution.js'

const SAFE_ADDRESS = '0x5afe000000000000000000000000000000000001' as Address
const SIGNATURE = `0x${'11'.repeat(65)}` as Hex
const SAFE_TX_HASH = `0x${'aa'.repeat(32)}` as Hash
const OTHER_SAFE_TX_HASH = `0x${'bb'.repeat(32)}` as Hash

// `getSafeApiKey` asks the client for the EVM provider; without one there is no key.
const client = { getProvider: () => undefined } as unknown as SDKClient

const proposal = {
  safeTxHash: SAFE_TX_HASH,
  nonce: '7',
  isExecuted: false,
  confirmations: [{ signature: SIGNATURE }],
}

const installSafeClient = (options: {
  transaction: Record<string, unknown>
  others?: Record<string, unknown>[]
}): void => {
  vi.mocked(getSafeClient).mockReturnValue({
    getInfo: vi.fn(),
    getTransactions: vi
      .fn()
      .mockResolvedValue({ results: [proposal, ...(options.others ?? [])] }),
    getTransaction: vi.fn().mockResolvedValue(options.transaction),
  } as unknown as SafeClientInterface)
}

const run = (): Promise<Hash> =>
  waitForSafeTransactionExecution(client, {
    chainId: 1,
    safeAddress: SAFE_ADDRESS,
    signature: SIGNATURE,
    pollingInterval: 1,
  })

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waitForSafeTransactionExecution', () => {
  it('marks a Safe transaction that executed unsuccessfully as final', async () => {
    installSafeClient({
      transaction: { isExecuted: true, isSuccessful: false },
    })

    await expect(run()).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Safe transaction failed.',
      final: true,
    })
  })

  it('marks a Safe transaction replaced by another one as final', async () => {
    vi.useFakeTimers()
    installSafeClient({
      transaction: { isExecuted: false },
      others: [
        {
          safeTxHash: OTHER_SAFE_TX_HASH,
          nonce: '7',
          isExecuted: true,
          confirmations: [],
        },
      ],
    })

    // The replacement check runs on every third poll.
    const outcome = run().then(
      () => undefined,
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await outcome).toMatchObject({
      code: LiFiErrorCode.TransactionCanceled,
      message: 'Safe transaction was replaced by another transaction.',
      final: true,
    })
  })

  it('leaves an executed Safe transaction without a hash unknown', async () => {
    installSafeClient({
      transaction: {
        isExecuted: true,
        isSuccessful: true,
        transactionHash: null,
      },
    })

    await expect(run()).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Safe transaction executed but no transaction hash returned.',
      final: false,
    })
  })

  it('leaves a timeout unknown', async () => {
    installSafeClient({ transaction: { isExecuted: false } })
    vi.mocked(waitForResult).mockRejectedValueOnce(
      new Error('Safe transaction polling timed out')
    )

    await expect(run()).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Safe transaction timed out waiting for execution.',
      final: false,
    })
  })
})
