import { toBase64 } from '@mysten/sui/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BYTES,
  DIGEST,
  SENDER_ADDRESS,
  SIGNATURE,
  TX_HEX,
} from '../../utils/suiSignedTransaction.unit.mock.js'

const getTransactionRequestData = vi.fn()
vi.mock('@lifi/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    getTransactionRequestData: (...args: unknown[]) =>
      getTransactionRequestData(...args),
  }
})

const { isFinalTransactionError, LiFiErrorCode } = await import('@lifi/sdk')
const { SuiSignAndExecuteTask } = await import('./SuiSignAndExecuteTask.js')

const EXPLORER = 'https://suiscan.xyz/mainnet/'

// `toHaveBeenCalledWith` ignores keys whose value is `undefined`, so each
// cleared key is pinned on its own.
const CLEARED_KEYS = ['txHash', 'txLink', 'txFinal', 'taskId'] as const

const succeeded = {
  $kind: 'Transaction',
  Transaction: { digest: DIGEST, status: { success: true, error: null } },
}

const makeContext = (
  action: Record<string, unknown> = { type: 'SWAP', status: 'ACTION_REQUIRED' }
) => {
  const calls: string[] = []
  const updateAction = vi.fn(
    (
      _step: unknown,
      _type: unknown,
      _status: unknown,
      params?: Record<string, unknown>
    ) => {
      calls.push(
        params && 'txHex' in params && typeof params.txHex === 'string'
          ? 'store'
          : 'update'
      )
    }
  )
  const signTransaction = vi.fn(async (bytes: Uint8Array) => {
    calls.push('sign')
    return { bytes: toBase64(bytes), signature: SIGNATURE }
  })
  const executeTransaction = vi.fn(async (): Promise<unknown> => {
    calls.push('execute')
    return succeeded
  })
  const signAndExecuteTransaction = vi.fn()
  return {
    calls,
    updateAction,
    signTransaction,
    executeTransaction,
    signAndExecuteTransaction,
    context: {
      step: {},
      suiClient: { core: { executeTransaction, signAndExecuteTransaction } },
      signer: { toSuiAddress: () => SENDER_ADDRESS, signTransaction },
      checkWallet: vi.fn(),
      executionOptions: undefined,
      fromChain: { metamask: { blockExplorerUrls: [EXPLORER] } },
      isBridgeExecution: false,
      statusManager: { findAction: () => action, updateAction },
    } as never,
  }
}

/** The `updateAction` calls that write the `txHex` key, also as `undefined`. */
const txHexWrites = (
  updateAction: ReturnType<typeof makeContext>['updateAction']
) =>
  updateAction.mock.calls.filter(
    ([, , , params]) => !!params && 'txHex' in params
  )

describe('SuiSignAndExecuteTask', () => {
  beforeEach(() => {
    getTransactionRequestData.mockReset().mockResolvedValue(toBase64(BYTES))
  })

  it('stores the signed bytes before it executes them', async () => {
    const { context, calls, updateAction } = makeContext()

    await new SuiSignAndExecuteTask().run(context)

    expect(calls).toEqual(['sign', 'store', 'execute', 'update'])
    const [, type, status, params = {}] = updateAction.mock.calls[0]
    expect(type).toBe('SWAP')
    expect(status).toBe('PENDING')
    // One write clears the previous transaction and stores the new bytes.
    for (const key of CLEARED_KEYS) {
      expect(key in params, key).toBe(true)
      expect(params[key], key).toBeUndefined()
    }
    expect(params.txHex).toBe(TX_HEX)
    expect(params.signedAt).toEqual(expect.any(Number))
  })

  it('signs with signer.signTransaction and executes exactly the signed bytes', async () => {
    const {
      context,
      signTransaction,
      executeTransaction,
      signAndExecuteTransaction,
    } = makeContext()

    await new SuiSignAndExecuteTask().run(context)

    expect(signTransaction).toHaveBeenCalledWith(BYTES)
    expect(executeTransaction).toHaveBeenCalledWith({
      transaction: BYTES,
      signatures: [SIGNATURE],
    })
    expect(signAndExecuteTransaction).not.toHaveBeenCalled()
  })

  it('writes the digest after execution and hands the result to the wait task', async () => {
    const { context, updateAction } = makeContext()

    const result = await new SuiSignAndExecuteTask().run(context)

    expect(updateAction).toHaveBeenLastCalledWith(
      expect.anything(),
      'SWAP',
      'PENDING',
      { txHash: DIGEST, txLink: `${EXPLORER}txblock/${DIGEST}` }
    )
    expect(result).toEqual({
      status: 'COMPLETED',
      context: { signedTransaction: succeeded.Transaction },
    })
    // The bytes stay stored until the wait task confirms the transaction.
    expect(txHexWrites(updateAction)).toHaveLength(1)
  })

  it('stores the digest of a FailedTransaction and fails final', async () => {
    const { context, executeTransaction, updateAction } = makeContext()
    executeTransaction.mockResolvedValue({
      $kind: 'FailedTransaction',
      FailedTransaction: {
        digest: DIGEST,
        status: {
          success: false,
          error: { message: 'MoveAbort', $kind: 'Unknown', Unknown: null },
        },
      },
    })

    await expect(
      new SuiSignAndExecuteTask().run(context)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      final: true,
    })
    expect(updateAction).toHaveBeenCalledWith(
      expect.anything(),
      'SWAP',
      'PENDING',
      { txHash: DIGEST, txLink: `${EXPLORER}txblock/${DIGEST}` }
    )
    // The executed bytes are spent, so the last write clears them.
    const [, , status, params = {}] = updateAction.mock.lastCall ?? []
    expect(status).toBe('PENDING')
    expect('txHex' in params).toBe(true)
    expect(params.txHex).toBeUndefined()
  })

  it('keeps the stored bytes when the execution outcome is unknown', async () => {
    const { context, executeTransaction, updateAction } = makeContext()
    const networkError = new Error('fetch failed')
    executeTransaction.mockRejectedValue(networkError)

    const error = await new SuiSignAndExecuteTask()
      .run(context)
      .catch((error: unknown) => error)

    expect(error).toBe(networkError)
    expect(isFinalTransactionError(error)).toBe(false)
    // Only the store wrote `txHex`; nothing cleared it.
    expect(txHexWrites(updateAction)).toHaveLength(1)
  })

  it('never asks the wallet to sign when the action has an open transaction', async () => {
    const { context, signTransaction, executeTransaction } = makeContext({
      type: 'SWAP',
      status: 'PENDING',
      txHex: TX_HEX,
    })

    await expect(
      new SuiSignAndExecuteTask().run(context)
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionConflict })

    expect(getTransactionRequestData).not.toHaveBeenCalled()
    expect(signTransaction).not.toHaveBeenCalled()
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('does not execute when the wallet returns no signature', async () => {
    const { context, signTransaction, executeTransaction, updateAction } =
      makeContext()
    signTransaction.mockResolvedValue({ bytes: toBase64(BYTES), signature: '' })

    await expect(
      new SuiSignAndExecuteTask().run(context)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionUnprepared,
      message:
        'Unable to prepare transaction. The signed transaction is incomplete.',
    })
    expect(executeTransaction).not.toHaveBeenCalled()
    expect(updateAction).not.toHaveBeenCalled()
  })
})
