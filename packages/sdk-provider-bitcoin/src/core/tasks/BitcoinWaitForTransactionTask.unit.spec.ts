import { LiFiErrorCode } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@bigmi/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bigmi/core')>()
  return { ...actual, waitForTransaction: vi.fn() }
})

import { type ReplacementReason, waitForTransaction } from '@bigmi/core'
import type { BitcoinStepExecutorContext } from '../../types.js'
import { BitcoinWaitForTransactionTask } from './BitcoinWaitForTransactionTask.js'

const SENDER = 'bc1qsender'
const TX_HASH = 'ab'.repeat(32)
const REPLACEMENT_TXID = 'cd'.repeat(32)

const makeContext = (): {
  context: BitcoinStepExecutorContext
  updateAction: ReturnType<typeof vi.fn>
} => {
  const updateAction = vi.fn()
  const context = {
    step: { action: { fromAddress: SENDER } },
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
    publicClient: {},
    checkClient: vi.fn(),
  } as unknown as BitcoinStepExecutorContext
  return { context, updateAction }
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
