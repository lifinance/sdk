import {
  type ExecutionAction,
  getTransactionRequestData,
  LiFiErrorCode,
} from '@lifi/sdk'
import { Psbt } from 'bitcoinjs-lib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lifi/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifi/sdk')>()
  return { ...actual, getTransactionRequestData: vi.fn() }
})

vi.mock('@bigmi/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bigmi/core')>()
  return {
    ...actual,
    signPsbt: vi.fn(),
    withTimeout: vi.fn((fn: () => Promise<unknown>) => fn()),
  }
})

vi.mock('../../utils/isPsbtFinalized.js', () => ({
  isPsbtFinalized: vi.fn(() => true),
}))

import { signPsbt } from '@bigmi/core'
import type { BitcoinStepExecutorContext } from '../../types.js'
import { BitcoinSignAndExecuteTask } from './BitcoinSignAndExecuteTask.js'

const SENDER = 'bc1qsender'
const TX_ID = 'ab'.repeat(32)
const TX_HEX = '0200000000010100'

const makeContext = (
  action: ExecutionAction
): {
  context: BitcoinStepExecutorContext
  updateAction: ReturnType<typeof vi.fn>
  sendUTXOTransaction: ReturnType<typeof vi.fn>
} => {
  const updateAction = vi.fn()
  const sendUTXOTransaction = vi.fn().mockResolvedValue(TX_ID)
  const context = {
    step: { action: { fromAddress: SENDER } },
    walletClient: { account: { address: SENDER } },
    publicClient: { sendUTXOTransaction },
    statusManager: {
      findAction: vi.fn().mockReturnValue(action),
      updateAction,
    },
    fromChain: { metamask: { blockExplorerUrls: ['https://mempool.space/'] } },
    isBridgeExecution: false,
    checkClient: vi.fn(),
  } as unknown as BitcoinStepExecutorContext
  return { context, updateAction, sendUTXOTransaction }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTransactionRequestData).mockResolvedValue('PSBT_HEX')
  vi.mocked(signPsbt).mockResolvedValue('SIGNED_PSBT' as never)
  // An input-less PSBT keeps the signing path free of real keys.
  vi.spyOn(Psbt, 'fromHex')
    .mockReturnValueOnce({
      data: { inputs: [] },
      toHex: () => 'UNSIGNED_PSBT',
    } as unknown as Psbt)
    .mockReturnValueOnce({
      extractTransaction: () => ({ toHex: () => TX_HEX }),
      finalizeAllInputs: vi.fn(),
    } as unknown as Psbt)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BitcoinSignAndExecuteTask pre-sign guard', () => {
  it.each([
    [
      'a pending hash',
      { type: 'SWAP', status: 'PENDING', txHash: TX_ID, txHex: TX_HEX },
    ],
    [
      'a FAILED hash without txFinal',
      { type: 'SWAP', status: 'FAILED', txHash: TX_ID, txHex: TX_HEX },
    ],
    ['stored bytes only', { type: 'SWAP', status: 'PENDING', txHex: TX_HEX }],
  ] as [string, ExecutionAction][])(
    'throws TransactionConflict and never opens the wallet for %s',
    async (_label, action) => {
      const { context, updateAction, sendUTXOTransaction } = makeContext(action)

      await expect(
        new BitcoinSignAndExecuteTask().run(context)
      ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })
      expect(getTransactionRequestData).not.toHaveBeenCalled()
      expect(signPsbt).not.toHaveBeenCalled()
      expect(sendUTXOTransaction).not.toHaveBeenCalled()
      expect(updateAction).not.toHaveBeenCalled()
    }
  )

  it('signs again after a final outcome and clears the old transaction fields', async () => {
    const { context, updateAction } = makeContext({
      type: 'SWAP',
      status: 'FAILED',
      txHash: 'old-hash',
      txHex: 'OLD_TX_HEX',
      txFinal: true,
    })

    await new BitcoinSignAndExecuteTask().run(context)

    expect(signPsbt).toHaveBeenCalledTimes(1)
    const params = updateAction.mock.calls.find(
      ([, , status]) => status === 'PENDING'
    )?.[3] as Record<string, unknown>
    expect(Object.keys(params)).toEqual(
      expect.arrayContaining(['txHash', 'txLink', 'txHex', 'txFinal', 'taskId'])
    )
    expect(params).toMatchObject({
      txHash: TX_ID,
      txLink: `https://mempool.space/tx/${TX_ID}`,
      txHex: TX_HEX,
    })
    expect(params.txFinal).toBeUndefined()
    expect(params.taskId).toBeUndefined()
  })
})
