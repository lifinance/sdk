import { LiFiErrorCode, MAX_RESEND_AGE_MS, TransactionError } from '@lifi/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@bigmi/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bigmi/core')>()
  return { ...actual, waitForTransaction: vi.fn() }
})

import { type ReplacementReason, waitForTransaction } from '@bigmi/core'
import type { BitcoinStepExecutorContext } from '../../types.js'
import { BitcoinWaitForTransactionTask } from './BitcoinWaitForTransactionTask.js'
import {
  allTransportsFailed,
  timeoutError,
} from './bitcoinRpcErrors.unit.mock.js'

const SENDER = 'bc1qsender'
const TX_HASH = 'ab'.repeat(32)
const REPLACEMENT_TXID = 'cd'.repeat(32)
const NOW = 1_800_000_000_000
const SEND = 'sendrawtransaction'
/** The one-round resend: one request, without bigmi's fallback retries. */
const ONE_ROUND_RESEND = [
  [{ method: SEND, params: ['SIGNED_TX_HEX'] }, { retryCount: 0 }],
]

const makeContext = (
  options: { signedAt?: number; bitcoinSent?: boolean } = {}
): {
  context: BitcoinStepExecutorContext
  updateAction: ReturnType<typeof vi.fn>
  request: ReturnType<typeof vi.fn>
} => {
  const updateAction = vi.fn()
  const request = vi.fn().mockResolvedValue(TX_HASH)
  const context = {
    step: {
      action: { fromAddress: SENDER },
      execution: {
        status: 'PENDING',
        actions: [],
        signedAt: options.signedAt,
      },
    },
    statusManager: {
      findAction: vi.fn().mockReturnValue({
        type: 'SWAP',
        status: 'PENDING',
        txHash: TX_HASH,
        txHex: 'SIGNED_TX_HEX',
      }),
      updateAction,
    },
    fromChain: { metamask: { blockExplorerUrls: ['https://mempool.space/'] } },
    isBridgeExecution: false,
    walletClient: { account: { address: SENDER } },
    publicClient: {
      request,
      // As in bigmi: `request` without options, so the fallback retries
      // the whole round.
      sendUTXOTransaction: ({ hex }: { hex: string }) =>
        request({ method: SEND, params: [hex] }),
    },
    checkClient: vi.fn(),
    bitcoinSent: options.bitcoinSent,
  } as unknown as BitcoinStepExecutorContext
  return { context, updateAction, request }
}

/** bigmi reports the replacement, then resolves with the replacing transaction. */
const replacedWith = (reason: ReplacementReason): void => {
  vi.mocked(waitForTransaction).mockImplementation((async (
    _client: unknown,
    parameters: { onReplaced?: (response: unknown) => void }
  ) => {
    parameters.onReplaced?.({
      reason,
      transaction: { txid: REPLACEMENT_TXID },
    })
    return { txid: REPLACEMENT_TXID }
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BitcoinWaitForTransactionTask', () => {
  it('marks a cancelled replacement as a final outcome', async () => {
    replacedWith('cancelled')
    const { context } = makeContext()

    await expect(
      new BitcoinWaitForTransactionTask().run(context)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionCanceled,
      message: 'User canceled transaction.',
      final: true,
    })
  })

  it('follows a replacement that is not a cancellation', async () => {
    replacedWith('replaced')
    const { context, updateAction } = makeContext()

    await expect(
      new BitcoinWaitForTransactionTask().run(context)
    ).resolves.toEqual({ status: 'COMPLETED' })
    expect(updateAction).toHaveBeenCalledWith(
      context.step,
      'SWAP',
      'PENDING',
      expect.objectContaining({ txHash: REPLACEMENT_TXID })
    )
  })

  it('leaves an RPC error unknown', async () => {
    const rpcError = new Error('mempool.space unavailable')
    vi.mocked(waitForTransaction).mockRejectedValue(rpcError)
    const { context } = makeContext()

    const thrown = await new BitcoinWaitForTransactionTask()
      .run(context)
      .catch((error: unknown) => error)

    expect(thrown).toBe(rpcError)
  })
})

describe('BitcoinWaitForTransactionTask resend on resume', () => {
  beforeEach(() => {
    vi.mocked(waitForTransaction).mockResolvedValue({
      txid: TX_HASH,
    } as never)
  })

  // bigmi's fallback retries a failed round up to 3 times: on an
  // "already" answer a node would get the same bytes 4 times.
  it('sends the stored bytes in one round before it waits, within the age cap', async () => {
    const { context, request } = makeContext({
      signedAt: NOW - 30_000,
    })

    await expect(
      new BitcoinWaitForTransactionTask().run(context)
    ).resolves.toEqual({ status: 'COMPLETED' })

    expect(request.mock.calls).toEqual(ONE_ROUND_RESEND)
    expect(waitForTransaction).toHaveBeenCalledTimes(1)
    expect(request.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(waitForTransaction).mock.invocationCallOrder[0] as number
    )
  })

  it('waits when the resend fails', async () => {
    const { context, updateAction, request } = makeContext({
      signedAt: NOW - 30_000,
    })
    request.mockRejectedValue(
      allTransportsFailed('sendrawtransaction', [
        timeoutError('sendrawtransaction'),
      ])
    )

    await expect(
      new BitcoinWaitForTransactionTask().run(context)
    ).resolves.toEqual({ status: 'COMPLETED' })

    expect(request.mock.calls).toEqual(ONE_ROUND_RESEND)
    expect(waitForTransaction).toHaveBeenCalledTimes(1)
    // A failed resend changes nothing in the stored transaction.
    expect(updateAction).not.toHaveBeenCalled()
  })

  it('checks the wallet before it resends: a changed wallet neither sends nor waits', async () => {
    const walletChanged = new TransactionError(
      LiFiErrorCode.WalletChangedDuringExecution,
      'The wallet address that requested the quote does not match the wallet address attempting to sign the transaction.'
    )
    const { context, request } = makeContext({
      signedAt: NOW - 30_000,
    })
    vi.mocked(context.checkClient).mockImplementation(() => {
      throw walletChanged
    })

    await expect(new BitcoinWaitForTransactionTask().run(context)).rejects.toBe(
      walletChanged
    )

    expect(request).not.toHaveBeenCalled()
    expect(waitForTransaction).not.toHaveBeenCalled()
  })

  it.each([
    ['at the age cap', NOW - MAX_RESEND_AGE_MS],
    ['past the age cap', NOW - MAX_RESEND_AGE_MS - 1],
    ['without signedAt', undefined],
  ])('never sends %s, and only waits', async (_label, signedAt) => {
    const { context, request } = makeContext({ signedAt })

    await new BitcoinWaitForTransactionTask().run(context)

    expect(request).not.toHaveBeenCalled()
    expect(waitForTransaction).toHaveBeenCalledTimes(1)
  })

  it('does not resend right after the sign task sent the bytes', async () => {
    const { context, request } = makeContext({
      signedAt: NOW - 1_000,
      bitcoinSent: true,
    })

    await new BitcoinWaitForTransactionTask().run(context)

    expect(request).not.toHaveBeenCalled()
    expect(waitForTransaction).toHaveBeenCalledTimes(1)
  })
})
