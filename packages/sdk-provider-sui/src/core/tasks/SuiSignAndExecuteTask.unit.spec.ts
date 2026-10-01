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

const { isFinalTransactionError, LiFiErrorCode, TransactionError } =
  await import('@lifi/sdk')
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

  it('reports the message of the Move error of a failed execution', async () => {
    const { context, executeTransaction } = makeContext()
    executeTransaction.mockResolvedValue({
      $kind: 'FailedTransaction',
      FailedTransaction: {
        digest: DIGEST,
        status: {
          success: false,
          error: {
            message: 'MoveAbort in 0x2::coin',
            $kind: 'MoveAbort',
            MoveAbort: { abortCode: '0' },
          },
        },
      },
    })

    await expect(
      new SuiSignAndExecuteTask().run(context)
    ).rejects.toMatchObject({
      code: LiFiErrorCode.TransactionFailed,
      message: 'Transaction failed: MoveAbort in 0x2::coin',
      final: true,
    })
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

  describe('an error from the wallet', () => {
    it.each([
      [
        'an Error that says "rejected"',
        new Error('User rejected the request.'),
        'User rejected the request.',
      ],
      [
        'an Error that says "REJECTED" in capitals',
        new Error('REJECTED BY USER'),
        'REJECTED BY USER',
      ],
      [
        'an object with code 4001 and a message',
        { code: 4001, message: 'x' },
        'x',
      ],
      [
        'an object with code 4001 and no message',
        { code: 4001 },
        'The wallet rejected the signature request.',
      ],
    ])('tags %s as SignatureRejected', async (_label, thrown, message) => {
      const { context, signTransaction, executeTransaction, updateAction } =
        makeContext()
      signTransaction.mockRejectedValue(thrown)

      const error = await new SuiSignAndExecuteTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(error).toBeInstanceOf(TransactionError)
      expect(error).toMatchObject({
        code: LiFiErrorCode.SignatureRejected,
        message,
        final: false,
      })
      expect((error as { cause?: unknown }).cause).toBe(thrown)
      // Nothing was signed, so nothing was stored or sent.
      expect(updateAction).not.toHaveBeenCalled()
      expect(executeTransaction).not.toHaveBeenCalled()
    })

    // These also pass with no classification at all. They guard it: it must
    // not tag an error without "reject", and an SDK error keeps its code.
    it.each([
      ['an Error without "reject"', new Error('Ledger device is locked')],
      [
        'an Error with another code',
        Object.assign(new Error('Request timed out'), { code: 4900 }),
      ],
      [
        'an SDK error that says "rejected"',
        new TransactionError(
          LiFiErrorCode.TransactionConflict,
          'The sponsor rejected the gas payment.'
        ),
      ],
    ])('rethrows %s unchanged', async (_label, thrown) => {
      const { context, signTransaction, executeTransaction, updateAction } =
        makeContext()
      signTransaction.mockRejectedValue(thrown)

      await expect(new SuiSignAndExecuteTask().run(context)).rejects.toBe(
        thrown
      )
      expect(updateAction).not.toHaveBeenCalled()
      expect(executeTransaction).not.toHaveBeenCalled()
    })

    it('does not classify an error from before the wallet call', async () => {
      // Only the signer's answer is the user's. Here a node said "rejected".
      const nodeError = new Error('Request rejected by the node')
      getTransactionRequestData.mockRejectedValue(nodeError)
      const { context, signTransaction } = makeContext()

      await expect(new SuiSignAndExecuteTask().run(context)).rejects.toBe(
        nodeError
      )
      expect(signTransaction).not.toHaveBeenCalled()
    })

    // Wallets also throw values that are not an Error. The classification
    // must read them without a TypeError.
    it.each([
      ['a string that says "Rejected"', 'Rejected from user', true],
      ['a string without "reject"', 'Wallet is locked', false],
      ['an object without a message', { reason: 'busy' }, false],
      ['undefined', undefined, false],
      ['null', null, false],
    ])(
      'classifies %s without a TypeError',
      async (_label, thrown, isRejection) => {
        const { context, signTransaction, executeTransaction } = makeContext()
        signTransaction.mockRejectedValue(thrown)

        const run = new SuiSignAndExecuteTask().run(context)

        if (isRejection) {
          const error = await run.catch((error: unknown) => error)
          expect(error).toBeInstanceOf(TransactionError)
          expect(error).toMatchObject({
            code: LiFiErrorCode.SignatureRejected,
            message: thrown,
          })
          expect((error as { cause?: unknown }).cause).toBe(thrown)
        } else {
          await expect(run).rejects.toBe(thrown)
        }
        expect(executeTransaction).not.toHaveBeenCalled()
      }
    )
  })
})
