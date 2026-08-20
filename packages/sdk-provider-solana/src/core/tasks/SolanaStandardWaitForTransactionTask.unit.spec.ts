import { LiFiErrorCode, RPCError, TransactionError } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'

vi.mock('@solana/kit', async () => ({
  ...(await vi.importActual<object>('@solana/kit')),
  getBase64EncodedWireTransaction: () => 'base64-encoded-tx',
  getSignatureFromTransaction: () => 'sig',
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

const { SolanaStandardWaitForTransactionTask } = await import(
  './SolanaStandardWaitForTransactionTask.js'
)

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

describe('SolanaStandardWaitForTransactionTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    callSolanaRpcsWithRetry.mockReset()
    sendAndConfirmTransaction.mockReset()
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
})
