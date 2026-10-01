import { getBase64EncodedWireTransaction } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  signatureFilledWith,
  signedNonceTransactionBase64,
  signedSwapTransactionBase64,
} from '../../utils/storedTransactions.unit.mock.js'

// No `@solana/kit` mock here, unlike the first-run spec: a resume decodes the
// real stored bytes, and the send must receive exactly those.

const isKnownToStatusApi = vi.fn()
vi.mock('@lifi/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@lifi/sdk')>()
  return {
    ...actual,
    isKnownToStatusApi: (...args: unknown[]) => isKnownToStatusApi(...args),
  }
})

const lookupSignatureStatus = vi.fn()
vi.mock('../../actions/lookupSignatureStatus.js', () => ({
  lookupSignatureStatus: (...args: unknown[]) => lookupSignatureStatus(...args),
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
const { MAX_RESEND_AGE_MS } = await import('@lifi/sdk')

const updateAction = vi.fn()

/** A resumed context: no `signedTransactions`, and the action carries
 * `fields`. */
const resumeContext = (fields: Record<string, unknown>, signedAt?: number) => {
  const step = { execution: { signedAt } }
  return {
    step,
    context: {
      client: {},
      step,
      statusManager: {
        findAction: () => ({ type: 'SWAP', status: 'PENDING', ...fields }),
        updateAction,
      },
      fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
      isBridgeExecution: false,
      // Enabled on purpose: a resume must skip the simulation by itself.
      skipSimulation: false,
    } as never,
  }
}

const txHexWrites = () =>
  updateAction.mock.calls
    .map((call) => call[3])
    .filter((params) => params && 'txHex' in params)

describe('SolanaStandardWaitForTransactionTask on resume', () => {
  beforeEach(() => {
    updateAction.mockReset()
    callSolanaRpcsWithRetry.mockReset()
    // The first look of a resume has no bounds: it finds, or it knows nothing.
    lookupSignatureStatus
      .mockReset()
      .mockResolvedValue({ kind: 'unknown', answered: true, errors: [] })
    isKnownToStatusApi.mockReset().mockResolvedValue(false)
    sendAndConfirmTransaction
      .mockReset()
      .mockImplementation(
        async (
          _client: unknown,
          _transaction: unknown,
          options: { onBroadcast: () => void }
        ) => {
          options.onBroadcast()
          return { kind: 'confirmed', value: { err: null } }
        }
      )
  })

  it('resends exactly the stored bytes, after the lookup, and never simulates', async () => {
    const txHex = signedSwapTransactionBase64(7)
    const { context } = resumeContext({ txHex }, Date.now())

    await expect(
      new SolanaStandardWaitForTransactionTask().run(context)
    ).resolves.toEqual({ status: 'COMPLETED' })

    // A simulation of a transaction that may already have landed, or whose
    // funds it already spent, would fail it falsely.
    expect(callSolanaRpcsWithRetry).not.toHaveBeenCalled()
    expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1)
    const [, sent] = sendAndConfirmTransaction.mock.calls[0]
    expect(getBase64EncodedWireTransaction(sent)).toBe(txHex)
    expect(lookupSignatureStatus.mock.invocationCallOrder[0]).toBeLessThan(
      sendAndConfirmTransaction.mock.invocationCallOrder[0]
    )

    const signature = signatureFilledWith(7)
    const txLink = `https://explorer/tx/${signature}`
    // The broadcast, then the confirmation with the bytes cleared.
    expect(updateAction.mock.calls.map((call) => call[3])).toEqual([
      { txHash: signature, txLink },
      { txHash: signature, txLink },
    ])
    expect(txHexWrites()).toHaveLength(1)
  })

  it('does not send a transaction the history lookup found', async () => {
    lookupSignatureStatus.mockResolvedValue({
      kind: 'found',
      status: { confirmationStatus: 'confirmed', err: null },
    })
    const { context } = resumeContext(
      { txHex: signedSwapTransactionBase64(7) },
      Date.now()
    )

    await expect(
      new SolanaStandardWaitForTransactionTask().run(context)
    ).resolves.toEqual({ status: 'COMPLETED' })

    expect(sendAndConfirmTransaction).not.toHaveBeenCalled()
  })

  it('keeps the resend gate open for a blockhash transaction, whatever its age', async () => {
    const { context } = resumeContext(
      { txHex: signedSwapTransactionBase64(7) },
      Date.now() - 60 * 60_000
    )

    await new SolanaStandardWaitForTransactionTask().run(context)

    const [, , options] = sendAndConfirmTransaction.mock.calls[0]
    expect(options.mayResend()).toBe(true)
  })

  it('closes the resend gate of a durable-nonce transaction at the age cap', async () => {
    const { context, step } = resumeContext(
      { txHex: signedNonceTransactionBase64(9) },
      Date.now() - (MAX_RESEND_AGE_MS - 10_000)
    )

    await new SolanaStandardWaitForTransactionTask().run(context)

    const [, , options] = sendAndConfirmTransaction.mock.calls[0]
    expect(options.mayResend()).toBe(true)
    // The resend loop outlives the check before the send by up to 90 s, so
    // the gate reads the age again at every send.
    step.execution.signedAt = Date.now() - (MAX_RESEND_AGE_MS + 1_000)
    expect(options.mayResend()).toBe(false)
  })

  it('keeps the stored bytes when the send path rejects on a resume', async () => {
    // On the first run nothing left the SDK, so the bytes go. On a resume
    // an earlier run may already have sent the same bytes.
    const rejection = new Error('Solana RPC URLs could not be read')
    sendAndConfirmTransaction.mockReset().mockRejectedValue(rejection)
    const { context } = resumeContext(
      { txHex: signedSwapTransactionBase64(7) },
      Date.now()
    )

    await expect(
      new SolanaStandardWaitForTransactionTask().run(context)
    ).rejects.toBe(rejection)

    expect(txHexWrites()).toEqual([])
  })
})
