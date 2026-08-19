import { LiFiErrorCode, RPCError, TransactionError } from '@lifi/sdk'
import { getSignatureFromTransaction, type Transaction } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'

const sendAndConfirmBundle = vi.fn()
vi.mock('../../actions/sendAndConfirmBundle.js', () => ({
  sendAndConfirmBundle: (...args: unknown[]) => sendAndConfirmBundle(...args),
}))

const { SolanaJitoWaitForTransactionTask } = await import(
  './SolanaJitoWaitForTransactionTask.js'
)

const updateAction = vi.fn()

// A decoded signed transaction, filled by position so the two fixtures carry
// distinct signatures. `getSignatureFromTransaction` reads nothing but the
// first entry of `signatures`.
const signedTransactionAt = (index: number): Transaction =>
  ({
    signatures: { feePayer: new Uint8Array(64).fill(index + 1) },
  }) as unknown as Transaction

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

describe('SolanaJitoWaitForTransactionTask', () => {
  beforeEach(() => {
    sendAndConfirmBundle.mockReset()
    updateAction.mockReset()
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
    // for one swap. The RPC's own `txSignatures` list is returned *reversed*
    // here to prove nothing depends on the order Jito reports - a task that
    // read `txSignatures[0]` would report the second transaction's signature
    // and fail below.
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

  it('records the explorer link when a Jito RPC accepts the submission, not at signing time', async () => {
    // Before broadcast the link would point at a transaction that may never
    // exist on chain - a failed submission, or the empty-Jito-list case,
    // never submits at all. The callback is how `sendAndConfirmBundle`
    // reports the moment the first RPC accepted the bundle.
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
})
