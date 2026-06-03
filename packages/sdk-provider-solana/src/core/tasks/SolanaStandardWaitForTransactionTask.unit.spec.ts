import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
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
    callSolanaRpcsWithRetry.mockResolvedValue({ value: { err: null } })
    const err = { Custom: 6_000 }
    sendAndConfirmTransaction.mockResolvedValue({
      signatureResult: { err },
      txSignature: 'sig',
    })

    const task = new SolanaStandardWaitForTransactionTask()
    const thrown = await task
      .run(baseContext({ skipSimulation: true }))
      .catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionFailed)
    expect(thrown.message).toBe('Transaction failed: {"Custom":6000}')
    expect(thrown.cause).toBeInstanceOf(SolanaTransactionDetailsError)
    expect(thrown.cause.err).toBe(err)
    expect(thrown.cause.logs).toBeNull()
  })
})
