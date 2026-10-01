import {
  isFinalTransactionError,
  LiFiErrorCode,
  MAX_RESEND_AGE_MS,
  RPCError,
  TransactionError,
} from '@lifi/sdk'
import {
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  type Transaction,
} from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'
import {
  signedNonceTransactionBase64,
  signedSwapTransactionBase64,
} from '../../utils/storedTransactions.unit.mock.js'

const sendAndConfirmBundle = vi.fn()
vi.mock('../../actions/sendAndConfirmBundle.js', () => ({
  sendAndConfirmBundle: (...args: unknown[]) => sendAndConfirmBundle(...args),
}))

const lookupSignatureStatus = vi.fn()
vi.mock('../../actions/lookupSignatureStatus.js', () => ({
  lookupSignatureStatus: (...args: unknown[]) => lookupSignatureStatus(...args),
}))

const isKnownToStatusApi = vi.fn()
vi.mock('@lifi/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    isKnownToStatusApi: (...args: unknown[]) => isKnownToStatusApi(...args),
  }
})

const { SolanaJitoWaitForTransactionTask } = await import(
  './SolanaJitoWaitForTransactionTask.js'
)

const updateAction = vi.fn()

const decodeWire = (wire: string): Transaction =>
  getTransactionDecoder().decode(getBase64Encoder().encode(wire))

// A decoded signed transaction, filled by position so the two fixtures carry
// distinct signatures. `getSignatureFromTransaction` reads nothing but the
// first entry of `signatures`. The captured swap message gives it a blockhash
// lifetime, so the resend gate lets it out without a signing time.
const signedTransactionAt = (index: number): Transaction =>
  decodeWire(signedSwapTransactionBase64(index + 1))

const baseContext = (
  signedTransactions: unknown[] = [
    signedTransactionAt(0),
    signedTransactionAt(1),
  ]
) =>
  ({
    client: {},
    step: {},
    statusManager: {
      findAction: () => ({ type: 'SWAP' }),
      updateAction,
    },
    fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
    isBridgeExecution: false,
    signedTransactions,
  }) as never

/** Every `updateAction` params object that names `txHex`. */
const txHexWrites = () =>
  updateAction.mock.calls
    .map((call) => call[3])
    .filter((params) => params && 'txHex' in params)

/** `baseContext`, signed a moment ago: the dropped check needs the signing
 * time for its anchor. */
const signedContext = () =>
  ({
    ...(baseContext() as object),
    step: { execution: { signedAt: Date.now() } },
  }) as never

describe('SolanaJitoWaitForTransactionTask', () => {
  beforeEach(() => {
    sendAndConfirmBundle.mockReset()
    updateAction.mockReset()
    lookupSignatureStatus.mockReset()
    isKnownToStatusApi.mockReset()
  })

  it('reports an unsignable transaction as a TransactionError', async () => {
    // `getSignatureFromTransaction` throws a bare `SolanaError` when the fee
    // payer's slot is null - reachable when a wallet returns a partially
    // signed bundle transaction. The task derives the signature up front now,
    // so that throw escapes the `LiFiErrorCode` contract and integrator error
    // branching falls through to the unknown bucket.
    const unsigned = {
      signatures: { feePayer: null },
    } as unknown as Transaction

    const thrown = await new SolanaJitoWaitForTransactionTask()
      .run(baseContext([unsigned]))
      .catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionUnprepared)
    expect(thrown.cause?.name).toBe('SolanaError')
    expect(sendAndConfirmBundle).not.toHaveBeenCalled()
  })

  it('surfaces bundle err through cause when a bundled tx fails', async () => {
    const err = { InstructionError: [0, 'AccountInUse'] }
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'confirmed',
      value: {
        signatureResults: [{ err: null }, { err }],
        txSignatures: ['sig0', 'sig1'],
        bundleId: 'bundle-id',
      },
    })

    const task = new SolanaJitoWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionFailed)
    expect(thrown.message).toContain('Transaction failed:')
    expect(thrown.cause).toBeInstanceOf(SolanaTransactionDetailsError)
    expect(thrown.cause.err).toBe(err)
  })

  it('serializes bigint payloads safely (regression: Jito used to call JSON.stringify without a replacer)', async () => {
    const err = { amount: 9_007_199_254_740_993n }
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'confirmed',
      value: {
        signatureResults: [{ err }],
        txSignatures: ['sig'],
        bundleId: 'bundle-id',
      },
    })

    const task = new SolanaJitoWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.message).toBe(
      'Transaction failed: {"amount":"9007199254740993"}'
    )
    expect(thrown.cause.err).toBe(err)
  })

  it('completes when a signature is not indexed yet: a landed bundle is atomic, so a null result is not a failure', async () => {
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'confirmed',
      value: {
        signatureResults: [{ err: null }, null],
        txSignatures: ['sig0', 'sig1'],
        bundleId: 'bundle-id',
      },
    })

    const task = new SolanaJitoWaitForTransactionTask()

    await expect(task.run(baseContext())).resolves.toEqual({
      status: 'COMPLETED',
    })
    const expectedSignature = getSignatureFromTransaction(
      signedTransactionAt(0)
    )
    expect(updateAction).toHaveBeenCalledWith({}, 'SWAP', 'PENDING', {
      txHash: expectedSignature,
      txLink: `https://explorer/tx/${expectedSignature}`,
    })
  })

  it('reports the signature of the first signed transaction, not the RPC-reported list', async () => {
    // One swap has two writers of `txHash`. `SolanaSignAndExecuteTask`
    // records `getSignatureFromTransaction(signedTransactions[0])` the moment
    // the wallet signs; this task re-derives the same value from the same
    // object after the wait, so the two cannot show an integrator two hashes
    // for one swap.
    const signedTransactions = [signedTransactionAt(0), signedTransactionAt(1)]
    const txSignatures = signedTransactions
      .map((signedTransaction) =>
        getSignatureFromTransaction(signedTransaction)
      )
      .reverse()
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'confirmed',
      value: {
        signatureResults: [{ err: null }, { err: null }],
        txSignatures,
        bundleId: 'bundle-id',
      },
    })

    const task = new SolanaJitoWaitForTransactionTask()

    await expect(task.run(baseContext(signedTransactions))).resolves.toEqual({
      status: 'COMPLETED',
    })

    const recordedBeforeTheWait = getSignatureFromTransaction(
      signedTransactions[0]
    )
    expect(recordedBeforeTheWait).not.toBe(
      getSignatureFromTransaction(signedTransactions[1])
    )
    expect(updateAction).toHaveBeenCalledWith({}, 'SWAP', 'PENDING', {
      txHash: recordedBeforeTheWait,
      txLink: `https://explorer/tx/${recordedBeforeTheWait}`,
    })
  })

  it('completes when no signature is indexed yet', async () => {
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'confirmed',
      value: {
        signatureResults: [null, null],
        txSignatures: ['sig0', 'sig1'],
        bundleId: 'bundle-id',
      },
    })

    const task = new SolanaJitoWaitForTransactionTask()

    await expect(task.run(baseContext())).resolves.toEqual({
      status: 'COMPLETED',
    })
  })

  it('throws TransactionExpired when an RPC polled and saw no confirmation', async () => {
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'not-confirmed',
      errors: [],
    })

    const task = new SolanaJitoWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    // `not-confirmed` also arrives from the wall-clock ceiling with no
    // blockhash probe at all, so the message must not name a single mechanism.
    expect(thrown.message).toBe(
      'Bundle was not confirmed before the SDK stopped waiting.'
    )
    // Every branch observed cleanly here, so there is no trail to chain.
    expect(thrown.cause).toBeUndefined()
  })

  it('chains the failed branch errors as the cause of TransactionExpired', async () => {
    // One Jito RPC polled to its deadline and saw nothing; another died
    // trying. That error is the only diagnostic explaining the expiry, so it
    // must survive into the thrown cause.
    const errors = [new Error('this endpoint never answered')]
    sendAndConfirmBundle.mockResolvedValue({ kind: 'not-confirmed', errors })

    const task = new SolanaJitoWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.cause).toBeInstanceOf(AggregateError)
    expect(thrown.cause.errors).toEqual(errors)
  })

  it('throws RpcUnavailable naming an outage when every configured Jito RPC failed', async () => {
    const errors = [new Error('no jito rpc')]
    sendAndConfirmBundle.mockResolvedValue({ kind: 'rpc-unavailable', errors })

    const task = new SolanaJitoWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    expect(thrown.code).toBe(LiFiErrorCode.RpcUnavailable)
    // The configuration gap (no Jito-capable RPC configured at all) throws
    // inside `sendAndConfirmBundle` with its own message; this arm is the
    // genuine outage and must say so, with the branch errors as the trail.
    expect(thrown.message).toBe(
      'Unable to confirm bundle: every configured Jito RPC failed.'
    )
    expect(thrown.cause).toBeInstanceOf(AggregateError)
    expect(thrown.cause.errors).toEqual(errors)
  })

  it('completes when the bundle-level err is the Ok variant, which is truthy', async () => {
    // Jito encodes the bundle-level `err` as a serialized Rust Result: a
    // landed bundle carries `{ Ok: null }`. A truthiness check on it would
    // fail every landed bundle.
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'confirmed',
      value: {
        signatureResults: [null, null],
        txSignatures: ['sig0', 'sig1'],
        bundleId: 'bundle-id',
        bundleErr: { Ok: null },
      },
    })

    const task = new SolanaJitoWaitForTransactionTask()

    await expect(task.run(baseContext())).resolves.toEqual({
      status: 'COMPLETED',
    })
  })

  it('surfaces the bundle-level Err variant even when the signature results degraded to all-null', async () => {
    // The degraded path is exactly where the per-signature scan sees nothing:
    // a failed `getSignatureStatuses` read leaves all-`null` results. The
    // bundle-level `err` rides the same response that confirmed the bundle,
    // so it is the one failure signal that survives the degrade.
    const failure = { InstructionError: [1, 'Custom'] }
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'confirmed',
      value: {
        signatureResults: [null, null],
        txSignatures: ['sig0', 'sig1'],
        bundleId: 'bundle-id',
        bundleErr: { Err: failure },
      },
    })

    const task = new SolanaJitoWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionFailed)
    expect(thrown.message).toContain('Transaction failed:')
    expect(thrown.cause).toBeInstanceOf(SolanaTransactionDetailsError)
    expect(thrown.cause.err).toBe(failure)
  })

  it('records the signature and link when a Jito RPC accepts the submission', async () => {
    // Before broadcast neither is real: a signed-but-unsent signature returns
    // `null` from `getTransaction`, and the empty-Jito-list case never submits
    // at all.
    const signedTransactions = [signedTransactionAt(0), signedTransactionAt(1)]
    const expectedSignature = getSignatureFromTransaction(signedTransactions[0])
    sendAndConfirmBundle.mockImplementation(
      async (
        _client: unknown,
        _transactions: unknown,
        options: { onBroadcast: () => void }
      ) => {
        options.onBroadcast()
        return {
          kind: 'confirmed',
          value: {
            signatureResults: [{ err: null }, { err: null }],
            txSignatures: ['sig0', 'sig1'],
            bundleId: 'bundle-id',
          },
        }
      }
    )

    const task = new SolanaJitoWaitForTransactionTask()
    await expect(task.run(baseContext(signedTransactions))).resolves.toEqual({
      status: 'COMPLETED',
    })

    expect(updateAction).toHaveBeenNthCalledWith(1, {}, 'SWAP', 'PENDING', {
      txHash: expectedSignature,
      txLink: `https://explorer/tx/${expectedSignature}`,
    })
    expect(updateAction).toHaveBeenNthCalledWith(2, {}, 'SWAP', 'PENDING', {
      txHash: expectedSignature,
      txLink: `https://explorer/tx/${expectedSignature}`,
    })
  })

  it('marks the CROSS_CHAIN action DONE for a bridge execution', async () => {
    // A bridge step selects the CROSS_CHAIN action and must close it out:
    // PENDING with the tx details, then DONE. Leaving it PENDING stalls the
    // step in the integrator's UI even though the bundle landed.
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'confirmed',
      value: {
        signatureResults: [{ err: null }, { err: null }],
        txSignatures: ['sig0', 'sig1'],
        bundleId: 'bundle-id',
      },
    })
    const findAction = vi.fn(() => ({ type: 'CROSS_CHAIN' }))
    const signedTransactions = [signedTransactionAt(0), signedTransactionAt(1)]
    const context = {
      client: {},
      step: {},
      statusManager: { findAction, updateAction },
      fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
      isBridgeExecution: true,
      signedTransactions,
    } as never

    const task = new SolanaJitoWaitForTransactionTask()

    await expect(task.run(context)).resolves.toEqual({ status: 'COMPLETED' })

    expect(findAction).toHaveBeenCalledWith({}, 'CROSS_CHAIN')
    const expectedSignature = getSignatureFromTransaction(signedTransactions[0])
    expect(updateAction).toHaveBeenCalledTimes(2)
    expect(updateAction).toHaveBeenNthCalledWith(
      1,
      {},
      'CROSS_CHAIN',
      'PENDING',
      {
        txHash: expectedSignature,
        txLink: `https://explorer/tx/${expectedSignature}`,
      }
    )
    expect(updateAction).toHaveBeenNthCalledWith(2, {}, 'CROSS_CHAIN', 'DONE')
  })

  it('completes when every bundled transaction confirms', async () => {
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'confirmed',
      value: {
        signatureResults: [{ err: null }, { err: null }],
        txSignatures: ['sig0', 'sig1'],
        bundleId: 'bundle-id',
      },
    })

    const task = new SolanaJitoWaitForTransactionTask()

    await expect(task.run(baseContext())).resolves.toEqual({
      status: 'COMPLETED',
    })
  })

  it('clears the stored bytes when no Jito RPC can take the bundle, because nothing was sent', async () => {
    // `sendAndConfirmBundle` throws the configuration gap before it submits
    // anything, so "Try again" may sign again (spec 4.2.9).
    const configurationGap = new RPCError(
      LiFiErrorCode.RpcUnavailable,
      'Jito bundle required, but no configured Solana RPC supports `sendBundle`. Supply a Jito-capable URL via the `rpcUrls` client config option.'
    )
    sendAndConfirmBundle.mockRejectedValue(configurationGap)

    await expect(
      new SolanaJitoWaitForTransactionTask().run(baseContext())
    ).rejects.toBe(configurationGap)

    expect(txHexWrites()).toEqual([{ txHex: undefined }])
  })

  it('clears the stored bytes when the first signature cannot be read', async () => {
    const unsigned = {
      signatures: { feePayer: null },
    } as unknown as Transaction

    await expect(
      new SolanaJitoWaitForTransactionTask().run(baseContext([unsigned]))
    ).rejects.toMatchObject({ code: LiFiErrorCode.TransactionUnprepared })

    expect(txHexWrites()).toEqual([{ txHex: undefined }])
  })

  it('marks a bundle Err final and clears the stored bytes', async () => {
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'confirmed',
      value: {
        signatureResults: [null, null],
        txSignatures: ['sig0', 'sig1'],
        bundleId: 'bundle-id',
        bundleErr: { Err: { InstructionError: [1, 'Custom'] } },
      },
    })

    const thrown = await new SolanaJitoWaitForTransactionTask()
      .run(baseContext())
      .catch((e) => e)

    expect(thrown.code).toBe(LiFiErrorCode.TransactionFailed)
    expect(thrown.final).toBe(true)
    expect(txHexWrites()).toHaveLength(1)
  })

  it('drops an expired bundle that no covering RPC has and the status API does not know', async () => {
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'expired',
      slot: 900n,
      errors: [],
    })
    lookupSignatureStatus.mockResolvedValue({ kind: 'not-found' })
    isKnownToStatusApi.mockResolvedValue(false)

    const thrown = await new SolanaJitoWaitForTransactionTask()
      .run(signedContext())
      .catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.message).toBe(
      'Bundle was not confirmed before the SDK stopped waiting.'
    )
    expect(thrown.final).toBe(true)
    const firstSignature = getSignatureFromTransaction(signedTransactionAt(0))
    expect(lookupSignatureStatus).toHaveBeenCalledWith(
      expect.anything(),
      firstSignature,
      expect.objectContaining({ expiredAtSlot: 900n })
    )
    expect(isKnownToStatusApi).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      firstSignature
    )
    expect(txHexWrites().at(-1)).toEqual({ txHex: undefined })
  })

  it('keeps an expired bundle unknown while the status API knows the first signature', async () => {
    // The veto: a covering RPC's null does not outweigh a known hash.
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'expired',
      slot: 900n,
      errors: [],
    })
    lookupSignatureStatus.mockResolvedValue({ kind: 'not-found' })
    isKnownToStatusApi.mockResolvedValue(true)

    const thrown = await new SolanaJitoWaitForTransactionTask()
      .run(signedContext())
      .catch((e) => e)

    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.final).toBe(false)
    expect(txHexWrites()).toEqual([])
  })

  it('keeps an expired bundle unknown while an RPC has the first signature only as processed', async () => {
    // Only a confirmed status counts as landed: a processed one can still
    // be dropped by a fork.
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'expired',
      slot: 900n,
      errors: [],
    })
    lookupSignatureStatus.mockResolvedValue({
      kind: 'found',
      status: { confirmationStatus: 'processed', err: null },
    })

    const thrown = await new SolanaJitoWaitForTransactionTask()
      .run(signedContext())
      .catch((e) => e)

    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.final).toBe(false)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
    expect(updateAction).not.toHaveBeenCalled()
  })

  it('looks a not-confirmed bundle up without a verdict slot', async () => {
    // Only an `expired` verdict carries a slot: the dropped check reads any
    // defined slot as a verdict. Signed long ago, so the time fallback runs
    // the lookup.
    sendAndConfirmBundle.mockResolvedValue({
      kind: 'not-confirmed',
      errors: [],
    })
    lookupSignatureStatus.mockResolvedValue({
      kind: 'unknown',
      answered: true,
      errors: [],
    })
    const context = {
      ...(baseContext() as object),
      step: { execution: { signedAt: Date.now() - 600_000 } },
    } as never

    const thrown = await new SolanaJitoWaitForTransactionTask()
      .run(context)
      .catch((e) => e)

    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.final).toBe(false)
    expect(lookupSignatureStatus).toHaveBeenCalledTimes(1)
    const lookupOptions = lookupSignatureStatus.mock.calls[0][2]
    expect('expiredAtSlot' in lookupOptions).toBe(true)
    expect(lookupOptions.expiredAtSlot).toBeUndefined()
    expect(txHexWrites()).toEqual([])
  })

  describe('with a durable nonce', () => {
    const nonceContext = (signedAt: number) =>
      ({
        ...(baseContext([
          decodeWire(signedNonceTransactionBase64(1)),
          decodeWire(signedNonceTransactionBase64(2)),
        ]) as object),
        step: { execution: { signedAt } },
      }) as never

    it('does not send the bundle past the resend age cap and keeps the outcome unknown', async () => {
      // A nonce never expires on its own, so only the age cap keeps a late
      // send from executing an old quote (spec 4.2.8). Past the cap, but not
      // old enough to drop: nothing is sent or looked up, and the bytes stay.
      const thrown = await new SolanaJitoWaitForTransactionTask()
        .run(nonceContext(Date.now() - MAX_RESEND_AGE_MS - 10_000))
        .catch((e) => e)

      expect(sendAndConfirmBundle).not.toHaveBeenCalled()
      expect(thrown).toBeInstanceOf(TransactionError)
      expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
      expect(isFinalTransactionError(thrown)).toBe(false)
      expect(thrown.cause.errors[0].message).toContain('resend age cap')
      expect(lookupSignatureStatus).not.toHaveBeenCalled()
      expect(txHexWrites()).toEqual([])
    })

    it('sends the bundle inside the resend age cap', async () => {
      sendAndConfirmBundle.mockResolvedValue({
        kind: 'confirmed',
        value: {
          signatureResults: [{ err: null }, { err: null }],
          txSignatures: ['sig0', 'sig1'],
          bundleId: 'bundle-id',
        },
      })

      await expect(
        new SolanaJitoWaitForTransactionTask().run(nonceContext(Date.now()))
      ).resolves.toEqual({ status: 'COMPLETED' })

      expect(sendAndConfirmBundle).toHaveBeenCalledTimes(1)
    })
  })
})
