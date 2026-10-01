import { TransactionError as SuiClientTransactionError } from '@mysten/sui/client'
import { RpcError } from '@mysten/sui/grpc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BYTES,
  DIGEST,
  SIGNATURE,
  TX_HEX,
} from '../../utils/suiSignedTransaction.unit.mock.js'

const isKnownToStatusApi = vi.fn()
vi.mock('@lifi/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    isKnownToStatusApi: (...args: unknown[]) => isKnownToStatusApi(...args),
  }
})

// The batch absence proof has its own spec; here it only returns a verdict.
const isSuiTransactionDropped = vi.fn()
vi.mock('./helpers/isSuiTransactionDropped.js', () => ({
  isSuiTransactionDropped: (...args: unknown[]) =>
    isSuiTransactionDropped(...args),
}))

// The fixture signature is not a real one; the signature check has its own
// spec. The codec itself stays real.
const verifySuiSignedTransaction = vi.fn()
vi.mock('../../utils/suiSignedTransaction.js', async (importActual) => {
  const actual =
    await importActual<typeof import('../../utils/suiSignedTransaction.js')>()
  return {
    ...actual,
    verifySuiSignedTransaction: (...args: unknown[]) =>
      verifySuiSignedTransaction(...args),
  }
})

// The Task 0 flag, switchable per test.
const task0 = vi.hoisted(() => ({ reexecutionReturnsEffects: false }))
vi.mock('../constants.js', () => ({
  get SUI_REEXECUTION_RETURNS_EFFECTS() {
    return task0.reexecutionReturnsEffects
  },
}))

const getTransaction = vi.fn()
const waitForTransaction = vi.fn()
const executeTransaction = vi.fn()
vi.mock('../../client/suiClient.js', () => ({
  callSuiWithRetry: (
    _client: unknown,
    fn: (client: unknown) => Promise<unknown>
  ) => fn({ core: { getTransaction, waitForTransaction, executeTransaction } }),
}))

const { isFinalTransactionError, LiFiErrorCode } = await import('@lifi/sdk')
const { SuiWaitForTransactionTask } = await import(
  './SuiWaitForTransactionTask.js'
)

const EXPLORER = 'https://suiscan.xyz/mainnet/'
const NOW = 1_790_000_000_000
const TX_LINK = `${EXPLORER}txblock/${DIGEST}`

const succeeded = {
  $kind: 'Transaction',
  Transaction: { digest: DIGEST, status: { success: true, error: null } },
}
const failed = {
  $kind: 'FailedTransaction',
  FailedTransaction: {
    digest: DIGEST,
    status: { success: false, error: { message: 'MoveAbort in 0x2::coin' } },
  },
}
const notFound = () => new SuiClientTransactionError('notFound', DIGEST)

const makeContext = (
  action: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
  execution: { signedAt?: number } = { signedAt: NOW - 60_000 }
) => {
  const updateAction = vi.fn()
  return {
    updateAction,
    context: {
      client: {},
      step: { execution },
      fromChain: { metamask: { blockExplorerUrls: [EXPLORER] } },
      isBridgeExecution: false,
      statusManager: { findAction: () => action, updateAction },
      ...overrides,
    } as never,
  }
}

type UpdateParams = Record<string, unknown> | undefined

/** The fourth `updateAction` argument: the fields it writes. */
const paramsOf = (call: unknown[]): UpdateParams => call[3] as UpdateParams

/** True when some write set `txHex` to `undefined`. */
const clearedTxHex = (updateAction: ReturnType<typeof vi.fn>): boolean =>
  updateAction.mock.calls.some((call) => {
    const params = paramsOf(call)
    return !!params && 'txHex' in params && params.txHex === undefined
  })

/**
 * The result write: it stores the digest and the link and clears `txHex` in
 * the same update, key by key.
 */
const expectResultWrite = (
  updateAction: ReturnType<typeof vi.fn>,
  type: string
): void => {
  const call = updateAction.mock.calls.find(
    (call) =>
      call[1] === type &&
      call[2] === 'PENDING' &&
      paramsOf(call)?.txHash === DIGEST
  )
  const params = call && paramsOf(call)
  expect(params).toBeDefined()
  expect(params?.txLink).toBe(TX_LINK)
  expect(params && 'txHex' in params).toBe(true)
  expect(params?.txHex).toBeUndefined()
}

describe('SuiWaitForTransactionTask', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    getTransaction.mockReset().mockRejectedValue(notFound())
    waitForTransaction.mockReset().mockResolvedValue(succeeded)
    executeTransaction.mockReset().mockResolvedValue(succeeded)
    verifySuiSignedTransaction.mockReset().mockResolvedValue(true)
    // Veto only: an unknown digest says nothing.
    isKnownToStatusApi.mockReset().mockResolvedValue(false)
    isSuiTransactionDropped.mockReset().mockResolvedValue(false)
    task0.reexecutionReturnsEffects = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('first run (executed in this session)', () => {
    it('waits for the digest, writes it and clears txHex', async () => {
      const { context, updateAction } = makeContext(
        { type: 'CROSS_CHAIN', txHex: TX_HEX },
        { signedTransaction: succeeded.Transaction, isBridgeExecution: true }
      )

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })

      expect(waitForTransaction).toHaveBeenCalledWith({ digest: DIGEST })
      expect(getTransaction).not.toHaveBeenCalled()
      expect(executeTransaction).not.toHaveBeenCalled()
      expect(verifySuiSignedTransaction).not.toHaveBeenCalled()
      expectResultWrite(updateAction, 'CROSS_CHAIN')
      expect(updateAction).toHaveBeenLastCalledWith(
        expect.anything(),
        'CROSS_CHAIN',
        'DONE'
      )
    })

    it('fails final on a FailedTransaction and stores its digest', async () => {
      waitForTransaction.mockResolvedValue(failed)
      const { context, updateAction } = makeContext(
        { type: 'SWAP', txHex: TX_HEX },
        { signedTransaction: succeeded.Transaction }
      )

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).rejects.toMatchObject({
        code: LiFiErrorCode.TransactionFailed,
        message: 'Transaction failed: MoveAbort in 0x2::coin',
        final: true,
      })
      expectResultWrite(updateAction, 'SWAP')
    })

    it('fails non-final on a malformed answer and keeps txHex', async () => {
      waitForTransaction.mockResolvedValue({ $kind: 'Unexpected' })
      const { context, updateAction } = makeContext(
        { type: 'SWAP', txHex: TX_HEX },
        { signedTransaction: succeeded.Transaction }
      )

      const error = await new SuiWaitForTransactionTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(error).toMatchObject({
        code: LiFiErrorCode.TransactionFailed,
        message:
          'Transaction failed: Unexpected transaction result: Unexpected',
      })
      expect(isFinalTransactionError(error)).toBe(false)
      expect(clearedTxHex(updateAction)).toBe(false)
    })

    it('keeps txHex when the wait itself fails', async () => {
      const timeout = new DOMException('signal timed out', 'TimeoutError')
      waitForTransaction.mockRejectedValue(timeout)
      const { context, updateAction } = makeContext(
        { type: 'SWAP', txHex: TX_HEX },
        { signedTransaction: succeeded.Transaction }
      )

      const error = await new SuiWaitForTransactionTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(error).toBe(timeout)
      expect(isFinalTransactionError(error)).toBe(false)
      expect(clearedTxHex(updateAction)).toBe(false)
    })
  })

  describe('resume (nothing in memory)', () => {
    it('completes from the lookup when the digest has already executed', async () => {
      getTransaction.mockResolvedValue(succeeded)
      const { context, updateAction } = makeContext({
        type: 'SWAP',
        txHash: DIGEST,
        txHex: TX_HEX,
      })

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })
      expect(getTransaction).toHaveBeenCalledWith({ digest: DIGEST })
      expect(executeTransaction).not.toHaveBeenCalled()
      expect(waitForTransaction).not.toHaveBeenCalled()
      expectResultWrite(updateAction, 'SWAP')
    })

    it('fails final when the lookup finds a FailedTransaction', async () => {
      getTransaction.mockResolvedValue(failed)
      const { context, updateAction } = makeContext({
        type: 'SWAP',
        txHex: TX_HEX,
      })

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).rejects.toMatchObject({
        code: LiFiErrorCode.TransactionFailed,
        final: true,
      })
      expect(executeTransaction).not.toHaveBeenCalled()
      expectResultWrite(updateAction, 'SWAP')
    })

    it('derives the digest from the stored bytes when no txHash was written', async () => {
      getTransaction.mockResolvedValue(succeeded)
      const { context } = makeContext({ type: 'SWAP', txHex: TX_HEX })

      await new SuiWaitForTransactionTask().run(context)

      expect(getTransaction).toHaveBeenCalledWith({ digest: DIGEST })
    })

    it('looks up the stored txHash before the digest of the stored bytes', async () => {
      const txHash = 'StoredTxHashDigest'
      getTransaction.mockResolvedValue({
        $kind: 'Transaction',
        Transaction: { digest: txHash, status: { success: true, error: null } },
      })
      const { context } = makeContext({
        type: 'SWAP',
        txHash,
        txHex: TX_HEX,
      })

      await new SuiWaitForTransactionTask().run(context)

      expect(getTransaction).toHaveBeenCalledTimes(1)
      expect(getTransaction).toHaveBeenCalledWith({ digest: txHash })
    })

    it('re-executes exactly the stored bytes and signature within the age cap', async () => {
      const { context, updateAction } = makeContext(
        { type: 'SWAP', txHex: TX_HEX },
        {},
        { signedAt: NOW - 119_999 }
      )

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })

      expect(verifySuiSignedTransaction).toHaveBeenCalledWith({
        bytes: BYTES,
        signature: SIGNATURE,
        digest: DIGEST,
      })
      expect(executeTransaction).toHaveBeenCalledTimes(1)
      expect(executeTransaction).toHaveBeenCalledWith({
        transaction: BYTES,
        signatures: [SIGNATURE],
      })
      expect(waitForTransaction).toHaveBeenCalledWith({ digest: DIGEST })
      expect(isSuiTransactionDropped).not.toHaveBeenCalled()
      expectResultWrite(updateAction, 'SWAP')
    })

    it('never sends past the age cap and reports dropped when the batch lookup proves absence', async () => {
      isSuiTransactionDropped.mockResolvedValue(true)
      const { context, updateAction } = makeContext(
        { type: 'SWAP', txHex: TX_HEX },
        {},
        { signedAt: NOW - 120_001 }
      )

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).rejects.toMatchObject({
        code: LiFiErrorCode.TransactionExpired,
        message: 'Transaction expired before it was executed.',
        final: true,
      })
      expect(executeTransaction).not.toHaveBeenCalled()
      expect(waitForTransaction).not.toHaveBeenCalled()
      expect(isSuiTransactionDropped).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        DIGEST
      )
      expect(clearedTxHex(updateAction)).toBe(true)
    })

    it('reports dropped by txHash when no stored bytes are left', async () => {
      isSuiTransactionDropped.mockResolvedValue(true)
      const { context } = makeContext(
        { type: 'SWAP', txHash: DIGEST },
        {},
        { signedAt: NOW - 120_001 }
      )

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).rejects.toMatchObject({
        code: LiFiErrorCode.TransactionExpired,
        final: true,
      })
      expect(verifySuiSignedTransaction).not.toHaveBeenCalled()
      expect(executeTransaction).not.toHaveBeenCalled()
    })

    // Without an absence proof (no covering response, or the status API
    // knows the digest) the outcome stays open: wait, never send.
    it('keeps waiting past the age cap without an absence proof', async () => {
      const { context } = makeContext(
        { type: 'SWAP', txHex: TX_HEX },
        {},
        { signedAt: NOW - 120_001 }
      )

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })
      expect(executeTransaction).not.toHaveBeenCalled()
      expect(isSuiTransactionDropped).toHaveBeenCalledTimes(1)
      expect(waitForTransaction).toHaveBeenCalledWith({ digest: DIGEST })
    })

    it('never sends and never drops when the signing time is unknown', async () => {
      const { context } = makeContext({ type: 'SWAP', txHex: TX_HEX }, {}, {})

      await new SuiWaitForTransactionTask().run(context)

      expect(executeTransaction).not.toHaveBeenCalled()
      expect(waitForTransaction).toHaveBeenCalledWith({ digest: DIGEST })
    })

    // A `false` can also mean a signature scheme the library cannot parse,
    // and a rejection means the check could not run: neither proves damage,
    // and the bytes may have been sent. The outcome stays unknown.
    describe.each([
      [
        'does not verify',
        () => verifySuiSignedTransaction.mockResolvedValue(false),
      ],
      [
        'cannot be verified',
        () =>
          verifySuiSignedTransaction.mockRejectedValue(
            new Error('A Sui Client is required')
          ),
      ],
    ])('when the stored signature %s', (_, setUp) => {
      beforeEach(() => {
        setUp()
      })

      it('never re-executes within the age cap and waits with txHex kept', async () => {
        const timeout = new DOMException('signal timed out', 'TimeoutError')
        waitForTransaction.mockRejectedValue(timeout)
        const { context, updateAction } = makeContext({
          type: 'SWAP',
          txHex: TX_HEX,
        })

        const error = await new SuiWaitForTransactionTask()
          .run(context)
          .catch((error: unknown) => error)

        expect(error).toBe(timeout)
        expect(isFinalTransactionError(error)).toBe(false)
        expect(verifySuiSignedTransaction).toHaveBeenCalledTimes(1)
        expect(executeTransaction).not.toHaveBeenCalled()
        expect(isSuiTransactionDropped).not.toHaveBeenCalled()
        expect(waitForTransaction).toHaveBeenCalledWith({ digest: DIGEST })
        expect(clearedTxHex(updateAction)).toBe(false)
      })

      it('never reports dropped past the age cap', async () => {
        isSuiTransactionDropped.mockResolvedValue(true)
        const timeout = new DOMException('signal timed out', 'TimeoutError')
        waitForTransaction.mockRejectedValue(timeout)
        const { context, updateAction } = makeContext(
          { type: 'SWAP', txHash: DIGEST, txHex: TX_HEX },
          {},
          { signedAt: NOW - 120_001 }
        )

        const error = await new SuiWaitForTransactionTask()
          .run(context)
          .catch((error: unknown) => error)

        expect(error).toBe(timeout)
        expect(isFinalTransactionError(error)).toBe(false)
        expect(isSuiTransactionDropped).not.toHaveBeenCalled()
        expect(executeTransaction).not.toHaveBeenCalled()
        expect(clearedTxHex(updateAction)).toBe(false)
      })

      it('still completes when the digest is found', async () => {
        waitForTransaction.mockResolvedValue(succeeded)
        const { context, updateAction } = makeContext({
          type: 'SWAP',
          txHex: TX_HEX,
        })

        await expect(
          new SuiWaitForTransactionTask().run(context)
        ).resolves.toEqual({ status: 'COMPLETED' })
        expect(executeTransaction).not.toHaveBeenCalled()
        expectResultWrite(updateAction, 'SWAP')
      })
    })

    it('reports dropped on a definite refusal when Task 0 confirmed that an executed transaction returns its effects', async () => {
      task0.reexecutionReturnsEffects = true
      executeTransaction.mockRejectedValue(
        new RpcError('object version unavailable', 'INVALID_ARGUMENT')
      )
      const { context, updateAction } = makeContext({
        type: 'SWAP',
        txHex: TX_HEX,
      })

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).rejects.toMatchObject({
        code: LiFiErrorCode.TransactionExpired,
        final: true,
      })
      // Looked up before and again after the refusal.
      expect(getTransaction).toHaveBeenCalledTimes(2)
      expect(isKnownToStatusApi).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        DIGEST
      )
      expect(clearedTxHex(updateAction)).toBe(true)
    })

    // Until Task 0 confirms it, the refusal may come from a digest that
    // already executed, so it proves nothing.
    it('keeps a definite refusal unknown while the Task 0 flag is off', async () => {
      const refusal = new RpcError(
        'object version unavailable',
        'INVALID_ARGUMENT'
      )
      executeTransaction.mockRejectedValue(refusal)
      const { context, updateAction } = makeContext({
        type: 'SWAP',
        txHex: TX_HEX,
      })

      const error = await new SuiWaitForTransactionTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(error).toBe(refusal)
      expect(isFinalTransactionError(error)).toBe(false)
      expect(getTransaction).toHaveBeenCalledTimes(2)
      expect(isKnownToStatusApi).not.toHaveBeenCalled()
      expect(clearedTxHex(updateAction)).toBe(false)
    })

    it('completes when the refused re-execution had in fact landed', async () => {
      getTransaction
        .mockRejectedValueOnce(notFound())
        .mockResolvedValueOnce(succeeded)
      executeTransaction.mockRejectedValue(
        new RpcError('object version unavailable', 'INVALID_ARGUMENT')
      )
      const { context, updateAction } = makeContext({
        type: 'SWAP',
        txHex: TX_HEX,
      })

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })
      expectResultWrite(updateAction, 'SWAP')
    })

    it('stays unknown when the refusal meets a status API that knows the digest', async () => {
      task0.reexecutionReturnsEffects = true
      isKnownToStatusApi.mockResolvedValue(true)
      const refusal = new RpcError(
        'object version unavailable',
        'INVALID_ARGUMENT'
      )
      executeTransaction.mockRejectedValue(refusal)
      const { context, updateAction } = makeContext({
        type: 'SWAP',
        txHex: TX_HEX,
      })

      await expect(new SuiWaitForTransactionTask().run(context)).rejects.toBe(
        refusal
      )
      expect(isKnownToStatusApi).toHaveBeenCalledTimes(1)
      expect(clearedTxHex(updateAction)).toBe(false)
    })

    it('stays unknown on a transport error of the re-execution', async () => {
      task0.reexecutionReturnsEffects = true
      const unavailable = new RpcError('upstream connect error', 'UNAVAILABLE')
      executeTransaction.mockRejectedValue(unavailable)
      const { context, updateAction } = makeContext({
        type: 'SWAP',
        txHex: TX_HEX,
      })

      const error = await new SuiWaitForTransactionTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(error).toBe(unavailable)
      expect(isFinalTransactionError(error)).toBe(false)
      expect(getTransaction).toHaveBeenCalledTimes(1)
      expect(isKnownToStatusApi).not.toHaveBeenCalled()
      expect(clearedTxHex(updateAction)).toBe(false)
    })

    it('stays unknown and does not send when the lookup fails', async () => {
      const lookupError = new Error('fetch failed')
      getTransaction.mockRejectedValue(lookupError)
      const { context, updateAction } = makeContext({
        type: 'SWAP',
        txHex: TX_HEX,
      })

      await expect(new SuiWaitForTransactionTask().run(context)).rejects.toBe(
        lookupError
      )
      expect(executeTransaction).not.toHaveBeenCalled()
      expect(isSuiTransactionDropped).not.toHaveBeenCalled()
      expect(clearedTxHex(updateAction)).toBe(false)
    })

    it('clears an invalid txHex and fails non-final when there is no txHash', async () => {
      const { context, updateAction } = makeContext({
        type: 'SWAP',
        txHex: JSON.stringify({ bytes: '***', signature: SIGNATURE }),
      })

      const error = await new SuiWaitForTransactionTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(error).toMatchObject({
        code: LiFiErrorCode.TransactionUnprepared,
        message:
          'Unable to resume transaction. The stored signed transaction is invalid.',
      })
      expect(isFinalTransactionError(error)).toBe(false)
      expect(clearedTxHex(updateAction)).toBe(true)
      expect(getTransaction).not.toHaveBeenCalled()
      expect(executeTransaction).not.toHaveBeenCalled()
    })

    it('drops an invalid txHex and continues by txHash without sending', async () => {
      const { context, updateAction } = makeContext({
        type: 'SWAP',
        txHash: DIGEST,
        txHex: 'not json',
      })

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })
      expect(clearedTxHex(updateAction)).toBe(true)
      expect(getTransaction).toHaveBeenCalledWith({ digest: DIGEST })
      expect(executeTransaction).not.toHaveBeenCalled()
      expect(waitForTransaction).toHaveBeenCalledWith({ digest: DIGEST })
    })

    it('fails when neither the context nor the action carries a transaction', async () => {
      const { context } = makeContext({ type: 'SWAP' })

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).rejects.toThrow(
        'Unable to prepare transaction. Signed transaction is not found.'
      )
    })
  })
})
