import { LiFiErrorCode, RPCError, TransactionError } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNonceMessageBytes } from '../../utils/getTransactionLifetime.unit.mock.js'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'

// Mutable so one spec can make the signature read throw the way
// `@solana/kit` does for a null fee-payer slot. `vi.hoisted` because the
// `vi.mock` factory is hoisted above ordinary top-level declarations.
const kit = vi.hoisted(() => ({ signatureThrows: false }))

vi.mock('@solana/kit', async () => ({
  ...(await vi.importActual<object>('@solana/kit')),
  getBase64EncodedWireTransaction: () => 'base64-encoded-tx',
  getSignatureFromTransaction: () => {
    if (kit.signatureThrows) {
      const error = new Error(
        "Could not determine this transaction's signature. Make sure that the transaction has been signed by its fee payer."
      )
      error.name = 'SolanaError'
      throw error
    }
    return 'sig'
  },
}))

const callSolanaRpcsWithRetry = vi.fn()
vi.mock('../../rpc/utils.js', () => ({
  callSolanaRpcsWithRetry: (...args: unknown[]) =>
    callSolanaRpcsWithRetry(...args),
}))

const sendAndConfirmTransaction = vi.fn()
vi.mock('../../actions/sendAndConfirmTransaction.js', () => ({
  sendAndConfirmTransaction: (...args: unknown[]) =>
    sendAndConfirmTransaction(...args),
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

const { SolanaStandardWaitForTransactionTask } = await import(
  './SolanaStandardWaitForTransactionTask.js'
)
const { MAX_RESEND_AGE_MS } = await import('@lifi/sdk')

const updateAction = vi.fn()

const baseContext = (overrides: Record<string, unknown> = {}) =>
  ({
    client: {},
    step: {},
    statusManager: {
      findAction: () => ({ type: 'SWAP' }),
      updateAction,
    },
    fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
    isBridgeExecution: false,
    signedTransactions: [{}],
    skipSimulation: false,
    ...overrides,
  }) as never

/** Every `updateAction` params object that names `txHex`. */
const txHexWrites = () =>
  updateAction.mock.calls
    .map((call) => call[3])
    .filter((params) => params && 'txHex' in params)

describe('SolanaStandardWaitForTransactionTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    callSolanaRpcsWithRetry.mockReset()
    sendAndConfirmTransaction.mockReset()
    lookupSignatureStatus.mockReset()
    isKnownToStatusApi.mockReset()
    kit.signatureThrows = false
  })

  it('reports an unsignable transaction as a TransactionError', async () => {
    // `getSignatureFromTransaction` throws a bare `SolanaError` when the fee
    // payer's slot is null. This task derives the signature before it sends,
    // so that throw escapes the `LiFiErrorCode` contract and integrator error
    // branching falls through to the unknown bucket.
    kit.signatureThrows = true

    const thrown = await new SolanaStandardWaitForTransactionTask()
      .run(baseContext({ skipSimulation: true }))
      .catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionUnprepared)
    expect(thrown.cause?.name).toBe('SolanaError')
    expect(sendAndConfirmTransaction).not.toHaveBeenCalled()
  })

  it('surfaces simulation err and logs through cause when preflight fails', async () => {
    const err = { InsufficientFundsForRent: { account_index: 0 } }
    const logs = ['Program log: ProgramError', 'Program failed: 0x1']
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err, logs } })

    const task = new SolanaStandardWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionSimulationFailed)
    expect(thrown.message).toContain('Transaction simulation failed:')
    expect(thrown.cause).toBeInstanceOf(SolanaTransactionDetailsError)
    expect(thrown.cause.err).toBe(err)
    expect(thrown.cause.logs).toBe(logs)
  })

  it('serializes bigint payloads safely on the cause message', async () => {
    callSolanaRpcsWithRetry.mockResolvedValue({
      value: { err: { amount: 1n }, logs: null },
    })

    const task = new SolanaStandardWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown.cause).toBeInstanceOf(SolanaTransactionDetailsError)
    expect(thrown.cause.message).toBe('{"amount":"1"}')
    expect(thrown.message).toBe('Transaction simulation failed: {"amount":"1"}')
  })

  it('surfaces a confirmed-with-err result through the cause', async () => {
    const err = { InstructionError: [0, 'AccountInUse'] }
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'confirmed',
      value: { err },
    })

    const task = new SolanaStandardWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionFailed)
    expect(thrown.message).toBe(
      'Transaction failed: {"InstructionError":[0,"AccountInUse"]}'
    )
    expect(thrown.cause).toBeInstanceOf(SolanaTransactionDetailsError)
    expect(thrown.cause.err).toBe(err)
    expect(thrown.cause.logs).toBeNull()
  })

  it('throws TransactionExpired when an RPC polled and saw no confirmation', async () => {
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'not-confirmed',
      errors: [],
    })

    const task = new SolanaStandardWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    // `not-confirmed` also arrives from the wall-clock ceiling with no
    // blockhash probe at all, so the message must not name a single mechanism.
    expect(thrown.message).toBe(
      'Transaction was not confirmed before the SDK stopped waiting.'
    )
    // Every branch observed cleanly here, so there is no trail to chain.
    expect(thrown.cause).toBeUndefined()
  })

  it('chains the failed branch errors as the cause of TransactionExpired', async () => {
    // One RPC polled to its deadline and saw nothing; the other never
    // answered and its branch threw. That error is the only diagnostic
    // explaining the expiry, so it must survive into the thrown cause.
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    const errors = [new Error('this endpoint never answered')]
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'not-confirmed',
      errors,
    })

    const task = new SolanaStandardWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.cause).toBeInstanceOf(AggregateError)
    expect(thrown.cause.errors).toEqual(errors)
  })

  it('records the explorer link when the first RPC accepts the send, not at signing time', async () => {
    // Before broadcast the link would point at a transaction that may never
    // exist on chain; after it, the user can watch the transaction land. The
    // callback is how `sendAndConfirmTransaction` reports that moment.
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockImplementation(
      async (
        _client: unknown,
        _transaction: unknown,
        options: { onBroadcast: () => void }
      ) => {
        options.onBroadcast()
        return { kind: 'confirmed', value: { err: null } }
      }
    )

    const task = new SolanaStandardWaitForTransactionTask()
    await expect(task.run(baseContext())).resolves.toEqual({
      status: 'COMPLETED',
    })

    expect(updateAction).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'SWAP',
      'PENDING',
      { txHash: 'sig', txLink: 'https://explorer/tx/sig' }
    )
    expect(updateAction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'SWAP',
      'PENDING',
      { txHash: 'sig', txLink: 'https://explorer/tx/sig' }
    )
  })

  it('throws RpcUnavailable when no RPC returned a usable response', async () => {
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    const errors = [new Error('method not found'), new Error('429')]
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'rpc-unavailable',
      errors,
    })

    const task = new SolanaStandardWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    // Guards the whole family of RpcUnavailable assertions in this package:
    // with a stale `packages/sdk/dist` the member is `undefined` on both
    // sides and every `toBe(LiFiErrorCode.RpcUnavailable)` passes vacuously.
    expect(LiFiErrorCode.RpcUnavailable).toBe(1027)
    expect(thrown.code).toBe(LiFiErrorCode.RpcUnavailable)
    expect(thrown.cause).toBeInstanceOf(AggregateError)
    expect(thrown.cause.errors).toEqual(errors)
  })

  it('completes and reports the signature when the transaction confirms', async () => {
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'confirmed',
      value: { err: null },
    })

    const task = new SolanaStandardWaitForTransactionTask()

    await expect(task.run(baseContext())).resolves.toEqual({
      status: 'COMPLETED',
    })

    expect(updateAction).toHaveBeenCalledWith(
      expect.anything(),
      'SWAP',
      'PENDING',
      {
        txHash: 'sig',
        txLink: 'https://explorer/tx/sig',
      }
    )
  })

  it('writes txLink at broadcast, then txHash on confirmation, then DONE', async () => {
    // The other bridge-path specs stub `sendAndConfirmTransaction` with a
    // bare `mockResolvedValue`, so `onBroadcast` never fires and their call
    // counts describe a sequence no live swap takes. This one drives the real
    // order: the link lands the moment an RPC accepts the send, the hash only
    // once the transaction confirmed.
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockImplementation(
      async (
        _client: unknown,
        _transaction: unknown,
        options: { onBroadcast: () => void }
      ) => {
        options.onBroadcast()
        return { kind: 'confirmed', value: { err: null } }
      }
    )
    const findAction = vi.fn(() => ({ type: 'CROSS_CHAIN' }))
    const context = baseContext({
      isBridgeExecution: true,
      statusManager: { findAction, updateAction },
    })

    const task = new SolanaStandardWaitForTransactionTask()

    await expect(task.run(context)).resolves.toEqual({ status: 'COMPLETED' })

    expect(updateAction).toHaveBeenCalledTimes(3)
    // Broadcast: the link alone. A txHash here would be no earlier than the
    // one `SolanaSignAndExecuteTask` already wrote at signing time.
    expect(updateAction).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'CROSS_CHAIN',
      'PENDING',
      { txHash: 'sig', txLink: 'https://explorer/tx/sig' }
    )
    expect(updateAction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'CROSS_CHAIN',
      'PENDING',
      { txHash: 'sig', txLink: 'https://explorer/tx/sig' }
    )
    expect(updateAction).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      'CROSS_CHAIN',
      'DONE'
    )
  })

  it('marks the CROSS_CHAIN action DONE for a bridge execution', async () => {
    // A bridge step selects the CROSS_CHAIN action and must close it out:
    // PENDING with the tx details, then DONE. Leaving it PENDING stalls the
    // step in the integrator's UI even though the transaction confirmed.
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'confirmed',
      value: { err: null },
    })
    const findAction = vi.fn(() => ({ type: 'CROSS_CHAIN' }))
    const context = baseContext({
      isBridgeExecution: true,
      statusManager: { findAction, updateAction },
    })

    const task = new SolanaStandardWaitForTransactionTask()

    await expect(task.run(context)).resolves.toEqual({ status: 'COMPLETED' })

    expect(findAction).toHaveBeenCalledWith(expect.anything(), 'CROSS_CHAIN')
    expect(updateAction).toHaveBeenCalledTimes(2)
    expect(updateAction).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'CROSS_CHAIN',
      'PENDING',
      {
        txHash: 'sig',
        txLink: 'https://explorer/tx/sig',
      }
    )
    expect(updateAction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'CROSS_CHAIN',
      'DONE'
    )
  })

  it('passes replaceRecentBlockhash to simulation', async () => {
    // Capture the args in the mock, assert AFTER the run. Asserting inside the
    // mock would surface a failure as a rejected task.run(), which the other
    // tests' .catch(e => e) would swallow into a green test.
    const simulateTransaction = vi.fn(() => ({
      send: () => Promise.resolve({ value: { err: null } }),
    }))
    callSolanaRpcsWithRetry.mockImplementation(
      async (_client: unknown, fn: (rpc: unknown) => Promise<unknown>) =>
        fn({ simulateTransaction })
    )
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'confirmed',
      value: { err: null },
    })

    const task = new SolanaStandardWaitForTransactionTask()
    await expect(task.run(baseContext())).resolves.toEqual({
      status: 'COMPLETED',
    })

    expect(simulateTransaction).toHaveBeenCalledTimes(1)
    expect(simulateTransaction).toHaveBeenCalledWith(
      'base64-encoded-tx',
      expect.objectContaining({ replaceRecentBlockhash: true })
    )
  })

  it('clears the stored bytes when the simulation fails, because nothing was sent', async () => {
    // Spec 4.2.9: "Try again" must sign again here. Resending bytes the
    // simulation rejected would only fail the same way.
    callSolanaRpcsWithRetry.mockResolvedValue({
      value: {
        err: { InsufficientFundsForRent: { account_index: 0 } },
        logs: [],
      },
    })

    const thrown = await new SolanaStandardWaitForTransactionTask()
      .run(baseContext())
      .catch((e) => e)

    expect(thrown.code).toBe(LiFiErrorCode.TransactionSimulationFailed)
    expect(sendAndConfirmTransaction).not.toHaveBeenCalled()
    expect(updateAction).toHaveBeenCalledTimes(1)
    expect(txHexWrites()).toEqual([{ txHex: undefined }])
  })

  it('clears the stored bytes when the send path rejects before its first send', async () => {
    // `sendAndConfirmTransaction` rejects only before it sends anything - the
    // RPC lists, the encoding. The race itself never rejects.
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    const rejection = new Error('Solana RPC URLs could not be read')
    sendAndConfirmTransaction.mockRejectedValue(rejection)

    await expect(
      new SolanaStandardWaitForTransactionTask().run(baseContext())
    ).rejects.toBe(rejection)

    expect(txHexWrites()).toEqual([{ txHex: undefined }])
  })

  it('clears the stored bytes once the transaction confirms', async () => {
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'confirmed',
      value: { err: null },
    })

    await new SolanaStandardWaitForTransactionTask().run(baseContext())

    const [, , , params] = updateAction.mock.calls.at(-1) ?? []
    expect(params.txHash).toBe('sig')
    expect('txHex' in params).toBe(true)
    expect(params.txHex).toBeUndefined()
  })

  it('marks a confirmed-with-err result final and clears the stored bytes', async () => {
    const err = { InstructionError: [0, 'AccountInUse'] }
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'confirmed',
      value: { err },
    })

    const thrown = await new SolanaStandardWaitForTransactionTask()
      .run(baseContext())
      .catch((e) => e)

    expect(thrown.code).toBe(LiFiErrorCode.TransactionFailed)
    expect(thrown.final).toBe(true)
    const [, , , params] = updateAction.mock.calls.at(-1) ?? []
    expect(params.txHash).toBe('sig')
    expect('txHex' in params).toBe(true)
  })

  it('drops an expired transaction that no covering RPC has and the status API does not know', async () => {
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'expired',
      slot: 900n,
      errors: [],
    })
    // What the lookup returns when a covering RPC's head passed slot 900.
    lookupSignatureStatus.mockResolvedValue({ kind: 'not-found' })
    isKnownToStatusApi.mockResolvedValue(false)

    const thrown = await new SolanaStandardWaitForTransactionTask()
      .run(baseContext({ step: { execution: { signedAt: Date.now() } } }))
      .catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    // Today's text: the widget shows the same message as before.
    expect(thrown.message).toBe(
      'Transaction was not confirmed before the SDK stopped waiting.'
    )
    expect(thrown.final).toBe(true)
    // The head the covering RPC must reach is the slot of the verdict.
    expect(lookupSignatureStatus).toHaveBeenCalledWith(
      expect.anything(),
      'sig',
      expect.objectContaining({ expiredAtSlot: 900n })
    )
    expect(isKnownToStatusApi).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'sig'
    )
    expect(txHexWrites().at(-1)).toEqual({ txHex: undefined })
  })

  it('keeps an expired transaction unknown while the status API knows its hash', async () => {
    // A covering RPC answered null, but the status API has the hash. It is a
    // veto: the transaction is real, whatever one node's history says.
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'expired',
      slot: 900n,
      errors: [],
    })
    lookupSignatureStatus.mockResolvedValue({ kind: 'not-found' })
    isKnownToStatusApi.mockResolvedValue(true)

    const thrown = await new SolanaStandardWaitForTransactionTask()
      .run(baseContext({ step: { execution: { signedAt: Date.now() } } }))
      .catch((e) => e)

    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.final).toBe(false)
    expect(txHexWrites()).toEqual([])
  })

  it('keeps an expired transaction unknown when no RPC can prove the absence', async () => {
    // A pruned node's null, or a head behind the verdict slot: the lookup
    // says unknown, and a status API miss cannot make up for it.
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'expired',
      slot: 900n,
      errors: [],
    })
    lookupSignatureStatus.mockResolvedValue({
      kind: 'unknown',
      answered: true,
      errors: [],
    })
    isKnownToStatusApi.mockResolvedValue(false)

    const thrown = await new SolanaStandardWaitForTransactionTask()
      .run(baseContext({ step: { execution: { signedAt: Date.now() } } }))
      .catch((e) => e)

    expect(thrown.final).toBe(false)
    expect(isKnownToStatusApi).not.toHaveBeenCalled()
    expect(txHexWrites()).toEqual([])
  })

  it('keeps a first-run not-confirmed unknown without asking the chain', async () => {
    // The 90 s ceiling says nothing about whether the transaction can still
    // land, and a transaction signed a moment ago is too young for the time
    // fallback.
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'not-confirmed',
      errors: [],
    })

    const thrown = await new SolanaStandardWaitForTransactionTask()
      .run(baseContext({ step: { execution: { signedAt: Date.now() } } }))
      .catch((e) => e)

    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.final).toBe(false)
    expect(lookupSignatureStatus).not.toHaveBeenCalled()
    expect(txHexWrites()).toEqual([])
  })

  it('passes no verdict slot to the lookup when the ceiling ended the wait', async () => {
    // Only an `expired` verdict names a slot. The time fallback of an old
    // transaction asks the chain without one, so a covering RPC's head is
    // checked against the current slot, not a verdict that never came.
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'not-confirmed',
      errors: [],
    })
    lookupSignatureStatus.mockResolvedValue({
      kind: 'unknown',
      answered: true,
      errors: [],
    })

    const thrown = await new SolanaStandardWaitForTransactionTask()
      .run(
        baseContext({
          step: { execution: { signedAt: Date.now() - 6 * 60_000 } },
        })
      )
      .catch((e) => e)

    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(thrown.final).toBe(false)
    expect(lookupSignatureStatus).toHaveBeenCalledTimes(1)
    const [, signature, lookupOptions] = lookupSignatureStatus.mock.calls[0]
    expect(signature).toBe('sig')
    expect(lookupOptions.anchor).toEqual(expect.any(Number))
    expect(lookupOptions.expiredAtSlot).toBeUndefined()
    expect(txHexWrites()).toEqual([])
  })

  it('keeps the stored bytes on an RPC outage', async () => {
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'rpc-unavailable',
      errors: [new Error('429')],
    })

    await expect(
      new SolanaStandardWaitForTransactionTask().run(baseContext())
    ).rejects.toBeInstanceOf(RPCError)

    expect(txHexWrites()).toEqual([])
  })

  it('closes the resend gate of a first-run durable-nonce send at the age cap', async () => {
    // A durable nonce has no expiry of its own. The first run's resend loop
    // reads the age cap at every send, as a resume does.
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      kind: 'confirmed',
      value: { err: null },
    })
    const step = {
      execution: { signedAt: Date.now() - (MAX_RESEND_AGE_MS - 10_000) },
    }
    const nonceTransaction = {
      messageBytes: createNonceMessageBytes(),
      signatures: { signer: new Uint8Array(64).fill(9) },
    }

    await new SolanaStandardWaitForTransactionTask().run(
      baseContext({ step, signedTransactions: [nonceTransaction] })
    )

    const [, sent, options] = sendAndConfirmTransaction.mock.calls[0]
    expect(sent).toBe(nonceTransaction)
    expect(options.mayResend()).toBe(true)
    step.execution.signedAt = Date.now() - (MAX_RESEND_AGE_MS + 1_000)
    expect(options.mayResend()).toBe(false)
  })
})
