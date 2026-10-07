import { TransactionError as SuiClientTransactionError } from '@mysten/sui/client'
import { RpcError } from '@mysten/sui/grpc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuiStepExecutorContext } from '../../types.js'
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

const getTransaction = vi.fn()
const waitForTransaction = vi.fn()
const executeTransaction = vi.fn()
// The fake nodes behind `callSuiWithRetry`. It tries each node in turn and
// throws the last error, as the real one does.
const suiNodes: unknown[] = []
vi.mock('../../client/suiClient.js', () => ({
  callSuiWithRetry: async (
    _client: unknown,
    fn: (client: unknown) => Promise<unknown>
  ) => {
    let lastError: unknown
    for (const node of suiNodes) {
      try {
        return await fn(node)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  },
}))

const { isFinalTransactionError, LiFiErrorCode } = await import('@lifi/sdk')
const { SUI_LOOKUP_TIMEOUT_MS } = await import('../constants.js')
const { SuiWaitForTransactionTask } = await import(
  './SuiWaitForTransactionTask.js'
)

const EXPLORER = 'https://suiscan.xyz/mainnet/'
const NOW = 1_790_000_000_000
// Not the digest of the stored bytes.
const FIRST_RUN_DIGEST = 'FirstRunDigestInMemory'

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
  type: string,
  digest: string = DIGEST
): void => {
  const call = updateAction.mock.calls.find(
    (call) =>
      call[1] === type &&
      call[2] === 'PENDING' &&
      paramsOf(call)?.txHash === digest
  )
  const params = call && paramsOf(call)
  expect(params).toBeDefined()
  expect(params?.txLink).toBe(`${EXPLORER}txblock/${digest}`)
  expect(params && 'txHex' in params).toBe(true)
  expect(params?.txHex).toBeUndefined()
}

describe('SuiWaitForTransactionTask', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    suiNodes.splice(0, suiNodes.length, {
      core: { getTransaction, waitForTransaction, executeTransaction },
    })
    getTransaction.mockReset().mockRejectedValue(notFound())
    waitForTransaction.mockReset().mockResolvedValue(succeeded)
    executeTransaction.mockReset().mockResolvedValue(succeeded)
    verifySuiSignedTransaction.mockReset().mockResolvedValue(true)
    // Veto only: an unknown digest says nothing.
    isKnownToStatusApi.mockReset().mockResolvedValue(false)
    isSuiTransactionDropped.mockReset().mockResolvedValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('first run (executed in this session)', () => {
    // The executed transaction in memory comes first in the digest order,
    // before a stored txHash and the digest of the stored bytes.
    it('waits for the digest in memory, writes it and clears txHex', async () => {
      const executed = {
        $kind: 'Transaction',
        Transaction: {
          digest: FIRST_RUN_DIGEST,
          status: { success: true, error: null },
        },
      }
      waitForTransaction.mockResolvedValue(executed)
      const { context, updateAction } = makeContext(
        { type: 'CROSS_CHAIN', txHash: DIGEST, txHex: TX_HEX },
        { signedTransaction: executed.Transaction, isBridgeExecution: true }
      )

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })

      expect(waitForTransaction).toHaveBeenCalledTimes(1)
      expect(waitForTransaction).toHaveBeenCalledWith({
        digest: FIRST_RUN_DIGEST,
      })
      expect(getTransaction).not.toHaveBeenCalled()
      expect(executeTransaction).not.toHaveBeenCalled()
      expect(verifySuiSignedTransaction).not.toHaveBeenCalled()
      expectResultWrite(updateAction, 'CROSS_CHAIN', FIRST_RUN_DIGEST)
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
      expect(getTransaction).toHaveBeenCalledWith({
        digest: DIGEST,
        signal: expect.any(AbortSignal),
      })
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

      expect(getTransaction).toHaveBeenCalledWith({
        digest: DIGEST,
        signal: expect.any(AbortSignal),
      })
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
      expect(getTransaction).toHaveBeenCalledWith({
        digest: txHash,
        signal: expect.any(AbortSignal),
      })
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
        signal: expect.any(AbortSignal),
      })
      expect(waitForTransaction).toHaveBeenCalledWith({ digest: DIGEST })
      expect(isSuiTransactionDropped).not.toHaveBeenCalled()
      expectResultWrite(updateAction, 'SWAP')
    })

    it('aborts a re-execution try when the age cap passes during it', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
      vi.setSystemTime(NOW)
      // As the transport does: the try ends when its signal aborts, and a
      // `TimeoutError` reason arrives as DEADLINE_EXCEEDED.
      const deadlineExceeded = new RpcError(
        'signal timed out',
        'DEADLINE_EXCEEDED'
      )
      executeTransaction.mockImplementation(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(deadlineExceeded))
          })
      )
      const { context, updateAction } = makeContext(
        { type: 'SWAP', txHex: TX_HEX },
        {},
        { signedAt: NOW - 60_000 }
      )

      const run = new SuiWaitForTransactionTask()
        .run(context)
        .catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(0)
      expect(executeTransaction).toHaveBeenCalledTimes(1)
      const [{ signal }] = executeTransaction.mock.calls[0] as [
        { signal: AbortSignal },
      ]

      // The cap passes 60 s from now.
      await vi.advanceTimersByTimeAsync(59_999)
      expect(signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(signal.aborted).toBe(true)
      expect(signal.reason).toBeInstanceOf(Error)
      expect(signal.reason).not.toBeInstanceOf(RpcError)
      expect(signal.reason).toMatchObject({ name: 'TimeoutError' })

      const error = await run
      expect(error).toBe(deadlineExceeded)
      expect(isFinalTransactionError(error)).toBe(false)
      expect(waitForTransaction).not.toHaveBeenCalled()
      expect(clearedTxHex(updateAction)).toBe(false)
    })

    it('clears the age-cap timer when the try ends', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
      vi.setSystemTime(NOW)
      const { context } = makeContext(
        { type: 'SWAP', txHex: TX_HEX },
        {},
        { signedAt: NOW - 60_000 }
      )

      await expect(
        new SuiWaitForTransactionTask().run(context)
      ).resolves.toEqual({ status: 'COMPLETED' })
      expect(executeTransaction).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })

    // `callSuiWithRetry` tries the nodes one by one, so the cap is checked
    // again before each try: the cap applies to every send.
    it('re-checks the age cap before each node and never sends past it', async () => {
      const refusal = new RpcError(
        'object version unavailable',
        'INVALID_ARGUMENT'
      )
      const firstNode = vi.fn(async () => {
        // The first node answers when the cap has passed.
        vi.setSystemTime(NOW + 60_000)
        throw refusal
      })
      const secondNode = vi.fn().mockResolvedValue(succeeded)
      suiNodes.splice(
        0,
        suiNodes.length,
        {
          core: {
            getTransaction,
            waitForTransaction,
            executeTransaction: firstNode,
          },
        },
        {
          core: {
            getTransaction,
            waitForTransaction,
            executeTransaction: secondNode,
          },
        }
      )
      const { context, updateAction } = makeContext(
        { type: 'SWAP', txHex: TX_HEX },
        {},
        { signedAt: NOW - 60_000 }
      )

      const error = await new SuiWaitForTransactionTask()
        .run(context)
        .catch((error: unknown) => error)

      expect(firstNode).toHaveBeenCalledTimes(1)
      expect(secondNode).not.toHaveBeenCalled()
      // The last try is the skipped one, so its error is the outcome.
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBe(refusal)
      expect(error).not.toBeInstanceOf(RpcError)
      expect(error).not.toMatchObject({
        code: LiFiErrorCode.TransactionExpired,
      })
      expect(isFinalTransactionError(error)).toBe(false)
      expect(isKnownToStatusApi).not.toHaveBeenCalled()
      expect(isSuiTransactionDropped).not.toHaveBeenCalled()
      expect(waitForTransaction).not.toHaveBeenCalled()
      expect(clearedTxHex(updateAction)).toBe(false)
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

    // `isSuiTransactionDropped` never drops without `signedAt`; the task
    // leaves that decision to it.
    it('never sends when the signing time is unknown and leaves the drop decision to the batch lookup', async () => {
      const { context } = makeContext({ type: 'SWAP', txHex: TX_HEX }, {}, {})

      await new SuiWaitForTransactionTask().run(context)

      expect(executeTransaction).not.toHaveBeenCalled()
      expect(isSuiTransactionDropped).toHaveBeenCalledWith(
        expect.anything(),
        { execution: {} },
        DIGEST
      )
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

      it('completes when the wait finds the digest that the lookup did not', async () => {
        const { context, updateAction } = makeContext({
          type: 'SWAP',
          txHex: TX_HEX,
        })

        await expect(
          new SuiWaitForTransactionTask().run(context)
        ).resolves.toEqual({ status: 'COMPLETED' })
        expect(getTransaction).toHaveBeenCalledTimes(1)
        expect(executeTransaction).not.toHaveBeenCalled()
        expectResultWrite(updateAction, 'SWAP')
      })
    })

    // Sui writes txHash from the execution result, which is the digest of
    // the stored bytes. A different txHash means damaged storage: neither
    // value proves anything, so the SDK only waits by txHash.
    it.each([
      ['within the age cap', NOW - 60_000],
      ['past the age cap', NOW - 120_001],
    ])(
      'never sends and never drops when txHash and the stored bytes disagree, %s',
      async (_, signedAt) => {
        const txHash = 'AnotherDigestThanTheStoredBytes'
        isSuiTransactionDropped.mockResolvedValue(true)
        const timeout = new DOMException('signal timed out', 'TimeoutError')
        waitForTransaction.mockRejectedValue(timeout)
        const { context, updateAction } = makeContext(
          { type: 'SWAP', txHash, txHex: TX_HEX },
          {},
          { signedAt }
        )

        const error = await new SuiWaitForTransactionTask()
          .run(context)
          .catch((error: unknown) => error)

        expect(error).toBe(timeout)
        expect(isFinalTransactionError(error)).toBe(false)
        expect(getTransaction).toHaveBeenCalledWith({
          digest: txHash,
          signal: expect.any(AbortSignal),
        })
        expect(executeTransaction).not.toHaveBeenCalled()
        expect(isSuiTransactionDropped).not.toHaveBeenCalled()
        expect(waitForTransaction).toHaveBeenCalledWith({ digest: txHash })
        expect(clearedTxHex(updateAction)).toBe(false)
      }
    )

    // A node refusal does not prove the transaction absent: a digest that
    // already executed is refused too.
    it('keeps a definite refusal unknown', async () => {
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

    // The transport reports the age-cap abort (a `TimeoutError` reason) as
    // DEADLINE_EXCEEDED and an abort by the caller as CANCELLED.
    it.each([
      ['a transport error', 'UNAVAILABLE'],
      ['the age-cap abort', 'DEADLINE_EXCEEDED'],
      ['an abort by the caller', 'CANCELLED'],
    ])('stays unknown on %s of the re-execution', async (_, code) => {
      const unavailable = new RpcError('upstream connect error', code)
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

    // A node that accepts the connection and never answers must not hold
    // the resume, and the route with it, open for good. Each lookup call to
    // a node has its own budget; past it the call is aborted, and the
    // outcome stays unknown.
    describe('when a lookup never answers', () => {
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
        vi.setSystemTime(NOW)
      })

      const never = (): Promise<never> => new Promise<never>(() => {})

      /** Runs the task; `state.settled` turns true when it settles. */
      const start = (context: SuiStepExecutorContext) => {
        const state = { settled: false }
        const result = new SuiWaitForTransactionTask()
          .run(context)
          .catch((error: unknown) => error)
          .finally(() => {
            state.settled = true
          })
        return { state, result }
      }

      it('fails non-final and never sends', async () => {
        getTransaction.mockImplementation(never)
        const { context, updateAction } = makeContext({
          type: 'SWAP',
          txHex: TX_HEX,
        })

        const { state, result } = start(context)
        await vi.advanceTimersByTimeAsync(SUI_LOOKUP_TIMEOUT_MS - 1)
        expect(state.settled).toBe(false)
        const [{ signal }] = getTransaction.mock.calls[0] as [
          { signal?: AbortSignal },
        ]
        expect(signal).toBeInstanceOf(AbortSignal)
        expect(signal?.aborted).toBe(false)
        await vi.advanceTimersByTimeAsync(2)
        expect(state.settled).toBe(true)

        const error = await result
        expect(signal?.aborted).toBe(true)
        expect(error).toBeInstanceOf(Error)
        expect(error).toMatchObject({ name: 'TimeoutError' })
        expect(isFinalTransactionError(error)).toBe(false)
        expect(getTransaction).toHaveBeenCalledTimes(1)
        expect(executeTransaction).not.toHaveBeenCalled()
        expect(isSuiTransactionDropped).not.toHaveBeenCalled()
        expect(waitForTransaction).not.toHaveBeenCalled()
        expect(clearedTxHex(updateAction)).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
      })

      // Without the second lookup the first execution may have landed
      // meanwhile.
      it('fails non-final when the lookup after a definite refusal never answers', async () => {
        getTransaction
          .mockRejectedValueOnce(notFound())
          .mockImplementation(never)
        executeTransaction.mockRejectedValue(
          new RpcError('object version unavailable', 'INVALID_ARGUMENT')
        )
        const { context, updateAction } = makeContext({
          type: 'SWAP',
          txHex: TX_HEX,
        })

        const { state, result } = start(context)
        await vi.advanceTimersByTimeAsync(SUI_LOOKUP_TIMEOUT_MS - 1)
        expect(state.settled).toBe(false)
        await vi.advanceTimersByTimeAsync(2)
        expect(state.settled).toBe(true)

        const error = await result
        expect(error).toMatchObject({ name: 'TimeoutError' })
        expect(error).not.toMatchObject({
          code: LiFiErrorCode.TransactionExpired,
        })
        expect(isFinalTransactionError(error)).toBe(false)
        expect(executeTransaction).toHaveBeenCalledTimes(1)
        expect(getTransaction).toHaveBeenCalledTimes(2)
        const [{ signal }] = getTransaction.mock.calls[1] as [
          { signal?: AbortSignal },
        ]
        expect(signal?.aborted).toBe(true)
        expect(isKnownToStatusApi).not.toHaveBeenCalled()
        expect(waitForTransaction).not.toHaveBeenCalled()
        expect(clearedTxHex(updateAction)).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
      })

      // As a node that fails: the budget is per node, so the next node is
      // still asked.
      it('asks the next node when a node never answers', async () => {
        const hung = vi.fn(never)
        suiNodes.splice(
          0,
          suiNodes.length,
          {
            core: {
              getTransaction: hung,
              waitForTransaction,
              executeTransaction,
            },
          },
          { core: { getTransaction, waitForTransaction, executeTransaction } }
        )
        getTransaction.mockResolvedValue(succeeded)
        const { context, updateAction } = makeContext({
          type: 'SWAP',
          txHash: DIGEST,
          txHex: TX_HEX,
        })

        const { state, result } = start(context)
        await vi.advanceTimersByTimeAsync(SUI_LOOKUP_TIMEOUT_MS + 1)
        expect(state.settled).toBe(true)

        await expect(result).resolves.toEqual({ status: 'COMPLETED' })
        expect(hung).toHaveBeenCalledTimes(1)
        expect(getTransaction).toHaveBeenCalledTimes(1)
        expect(executeTransaction).not.toHaveBeenCalled()
        expectResultWrite(updateAction, 'SWAP')
        expect(vi.getTimerCount()).toBe(0)
      })
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
      expect(getTransaction).toHaveBeenCalledWith({
        digest: DIGEST,
        signal: expect.any(AbortSignal),
      })
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
