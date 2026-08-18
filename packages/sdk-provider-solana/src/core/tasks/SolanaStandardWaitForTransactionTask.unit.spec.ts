import { LiFiErrorCode, RPCError, TransactionError } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'

vi.mock('@solana/kit', async () => ({
  ...(await vi.importActual<object>('@solana/kit')),
  getBase64EncodedWireTransaction: () => 'base64-encoded-tx',
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

const baseContext = (overrides: Record<string, unknown> = {}) =>
  ({
    client: {},
    step: {},
    statusManager: {
      findAction: () => ({ type: 'SWAP' }),
      updateAction: () => {},
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

  it('surfaces post-send signatureResult err through cause', async () => {
    const err = { InstructionError: [0, 'AccountInUse'] }
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      result: { kind: 'confirmed', value: { err } },
      txSignature: 'sig',
    })

    const task = new SolanaStandardWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionFailed)
    expect(thrown.cause).toBeInstanceOf(SolanaTransactionDetailsError)
  })

  it('throws TransactionExpired when an RPC polled and saw no confirmation', async () => {
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      result: { kind: 'not-confirmed' },
      txSignature: 'sig',
    })

    const task = new SolanaStandardWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
  })

  it('throws RpcUnavailable when no RPC returned a usable response', async () => {
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    const errors = [new Error('method not found'), new Error('429')]
    sendAndConfirmTransaction.mockResolvedValue({
      result: { kind: 'rpc-unavailable', errors },
      txSignature: 'sig',
    })

    const task = new SolanaStandardWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    expect(thrown.code).toBe(LiFiErrorCode.RpcUnavailable)
    expect(thrown.cause).toBeInstanceOf(AggregateError)
    expect(thrown.cause.errors).toEqual(errors)
  })

  it('completes and reports the signature when the transaction confirms', async () => {
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    sendAndConfirmTransaction.mockResolvedValue({
      result: { kind: 'confirmed', value: { err: null } },
      txSignature: 'sig',
    })

    const task = new SolanaStandardWaitForTransactionTask()

    await expect(task.run(baseContext())).resolves.toEqual({
      status: 'COMPLETED',
    })
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
      result: { kind: 'confirmed', value: { err: null } },
      txSignature: 'sig',
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
