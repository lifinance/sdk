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
    sendAndConfirmBundle.mockResolvedValue({ kind: 'not-confirmed' })

    const task = new SolanaJitoWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    // `not-confirmed` also arrives from the wall-clock ceiling with no
    // blockhash probe at all, so the message must not name a single mechanism.
    expect(thrown.message).toBe(
      'Bundle was not confirmed before the SDK stopped waiting.'
    )
  })

  it('throws RpcUnavailable when no Jito RPC returned a usable response', async () => {
    const errors = [new Error('no jito rpc')]
    sendAndConfirmBundle.mockResolvedValue({ kind: 'rpc-unavailable', errors })

    const task = new SolanaJitoWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    expect(thrown.code).toBe(LiFiErrorCode.RpcUnavailable)
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
