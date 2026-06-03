import { LiFiErrorCode, TransactionError } from '@lifi/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SolanaTransactionDetailsError } from '../../utils/solanaErrorCause.js'

const sendAndConfirmBundle = vi.fn()
vi.mock('../../actions/sendAndConfirmBundle.js', () => ({
  sendAndConfirmBundle: (...args: unknown[]) => sendAndConfirmBundle(...args),
}))

const { SolanaJitoWaitForTransactionTask } = await import(
  './SolanaJitoWaitForTransactionTask.js'
)

const baseContext = () =>
  ({
    client: {},
    step: {},
    statusManager: {
      findAction: () => ({ type: 'SWAP' }),
      updateAction: () => {},
    },
    fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
    isBridgeExecution: false,
    signedTransactions: [{}, {}],
  }) as never

describe('SolanaJitoWaitForTransactionTask', () => {
  beforeEach(() => {
    sendAndConfirmBundle.mockReset()
  })

  it('surfaces bundle err through cause when a bundled tx fails', async () => {
    const err = { InstructionError: [0, 'AccountInUse'] }
    sendAndConfirmBundle.mockResolvedValue({
      signatureResults: [{ err: null }, { err }],
      txSignatures: ['sig0', 'sig1'],
      bundleId: 'bundle-id',
    })

    const task = new SolanaJitoWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.code).toBe(LiFiErrorCode.TransactionFailed)
    expect(thrown.message).toContain('Transaction failed:')
    expect(thrown.cause).toBeInstanceOf(SolanaTransactionDetailsError)
    expect(thrown.cause.err).toBe(err)
    expect(thrown.cause.logs).toBeNull()
  })

  it('serializes bigint payloads safely (regression: Jito used to call JSON.stringify without a replacer)', async () => {
    const err = { amount: 9_007_199_254_740_993n }
    sendAndConfirmBundle.mockResolvedValue({
      signatureResults: [{ err }],
      txSignatures: ['sig'],
      bundleId: 'bundle-id',
    })

    const task = new SolanaJitoWaitForTransactionTask()
    const thrown = await task.run(baseContext()).catch((e) => e)

    expect(thrown).toBeInstanceOf(TransactionError)
    expect(thrown.message).toBe(
      'Transaction failed: {"amount":"9007199254740993"}'
    )
    expect(thrown.cause.err).toBe(err)
  })
})
