import { LiFiErrorCode } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const callTronRpcsWithRetry = vi.fn()
vi.mock('../../rpc/callTronRpcsWithRetry.js', () => ({
  callTronRpcsWithRetry: (...args: unknown[]) => callTronRpcsWithRetry(...args),
}))

const { TronSignAndExecuteTask } = await import('./TronSignAndExecuteTask.js')

const TX_ID = 'c3e7a4c5c0b8d2f1e9a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f809102'

const UNSIGNED_TRANSACTION = {
  visible: false,
  txID: TX_ID,
  raw_data: {
    contract: [],
    ref_block_bytes: '1a2b',
    ref_block_hash: '0011223344556677',
    expiration: 1_790_000_060_000,
    timestamp: 1_790_000_000_000,
  },
  raw_data_hex: '0a021a2b',
}

const SIGNED_TRANSACTION = { ...UNSIGNED_TRANSACTION, signature: ['c0ffee'] }

// `toEqual` ignores keys whose value is `undefined`, so each cleared key is
// pinned on its own.
const CLEARED_KEYS = ['txHash', 'txLink', 'txFinal', 'taskId'] as const

const expectPreviousTransactionCleared = (params: Record<string, unknown>) => {
  for (const key of CLEARED_KEYS) {
    expect(key in params, key).toBe(true)
    expect(params[key], key).toBeUndefined()
  }
}

const makeContext = (action: Record<string, unknown>) => {
  const updateAction = vi.fn()
  const signTransaction = vi.fn(async () => SIGNED_TRANSACTION)
  const checkWallet = vi.fn()
  return {
    updateAction,
    signTransaction,
    checkWallet,
    context: {
      step: { transactionRequest: { data: '0x0a021a2b' } },
      client: {},
      wallet: { signTransaction },
      checkWallet,
      allowUserInteraction: true,
      isBridgeExecution: false,
      statusManager: { findAction: () => action, updateAction },
    } as never,
  }
}

describe('TronSignAndExecuteTask', () => {
  beforeEach(() => {
    callTronRpcsWithRetry.mockReset().mockResolvedValue(UNSIGNED_TRANSACTION)
  })

  it('stores the signed transaction JSON with signedAt and clears the previous transaction in one write', async () => {
    const { context, updateAction } = makeContext({
      type: 'SWAP',
      status: 'STARTED',
    })

    const result = await new TronSignAndExecuteTask().run(context)

    expect(result).toEqual({
      status: 'COMPLETED',
      context: { signedTransaction: SIGNED_TRANSACTION },
    })
    const [, type, status, params] = updateAction.mock.calls.at(-1) ?? []
    expect(type).toBe('SWAP')
    expect(status).toBe('PENDING')
    expect(params).toEqual({
      txHex: JSON.stringify(SIGNED_TRANSACTION),
      signedAt: expect.any(Number),
    })
    // The previous transaction's fields are present as explicit `undefined`,
    // so `Object.assign` in `updateAction` really erases them.
    expectPreviousTransactionCleared(params)
    expect(JSON.parse(params.txHex)).toEqual(SIGNED_TRANSACTION)
  })

  it('never asks the wallet to sign when the action has an open transaction', async () => {
    const { context, signTransaction, checkWallet, updateAction } = makeContext(
      {
        type: 'SWAP',
        status: 'PENDING',
        txHex: JSON.stringify(SIGNED_TRANSACTION),
      }
    )

    await expect(
      new TronSignAndExecuteTask().run(context)
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })

    expect(checkWallet).not.toHaveBeenCalled()
    expect(signTransaction).not.toHaveBeenCalled()
    expect(callTronRpcsWithRetry).not.toHaveBeenCalled()
    expect(updateAction).not.toHaveBeenCalled()
  })

  it('signs again after a final failure of the previous transaction', async () => {
    const { context, signTransaction, updateAction } = makeContext({
      type: 'SWAP',
      status: 'FAILED',
      txHash: 'old-hash',
      txFinal: true,
    })

    await new TronSignAndExecuteTask().run(context)

    expect(signTransaction).toHaveBeenCalledTimes(1)
    const [, , status, params] = updateAction.mock.calls.at(-1) ?? []
    expect(status).toBe('PENDING')
    // The old hash and its final flag must not survive the new signature.
    expectPreviousTransactionCleared(params)
  })

  it('fails before any broadcast when the signed transaction has no readable txID', async () => {
    const { context, signTransaction, updateAction } = makeContext({
      type: 'SWAP',
      status: 'STARTED',
    })
    signTransaction.mockResolvedValue({ ...SIGNED_TRANSACTION, txID: '' })

    await expect(
      new TronSignAndExecuteTask().run(context)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionUnprepared,
      message:
        'Unable to prepare transaction. The signed transaction is incomplete.',
    })

    // Only the ACTION_REQUIRED write happened: no txHex, no signedAt.
    expect(updateAction).toHaveBeenCalledTimes(1)
    expect(updateAction).toHaveBeenCalledWith(
      expect.anything(),
      'SWAP',
      'ACTION_REQUIRED'
    )
  })
})
