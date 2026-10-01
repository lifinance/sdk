import { getBase64EncodedWireTransaction, type Transaction } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  signatureFilledWith,
  signedNonceTransactionBase64,
  signedSwapTransactionBase64,
} from '../../utils/storedTransactions.unit.mock.js'

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

const sendAndConfirmBundle = vi.fn()
vi.mock('../../actions/sendAndConfirmBundle.js', () => ({
  sendAndConfirmBundle: (...args: unknown[]) => sendAndConfirmBundle(...args),
}))

const { SolanaJitoWaitForTransactionTask } = await import(
  './SolanaJitoWaitForTransactionTask.js'
)
const { isFinalTransactionError, LiFiErrorCode, MAX_RESEND_AGE_MS, RPCError } =
  await import('@lifi/sdk')

const updateAction = vi.fn()

/** A resumed context: no `signedTransactions`, and the action carries
 * `fields`. */
const resumeContext = (fields: Record<string, unknown>, signedAt?: number) =>
  ({
    client: {},
    step: { execution: { signedAt } },
    statusManager: {
      findAction: () => ({ type: 'SWAP', status: 'PENDING', ...fields }),
      updateAction,
    },
    fromChain: { metamask: { blockExplorerUrls: ['https://explorer/'] } },
    isBridgeExecution: false,
  }) as never

const txHexWrites = () =>
  updateAction.mock.calls
    .map((call) => call[3])
    .filter((params) => params && 'txHex' in params)

const WIRES = [signedSwapTransactionBase64(7), signedSwapTransactionBase64(8)]

describe('SolanaJitoWaitForTransactionTask on resume', () => {
  beforeEach(() => {
    updateAction.mockReset()
    // The first look of a resume has no bounds: it finds, or it knows nothing.
    lookupSignatureStatus
      .mockReset()
      .mockResolvedValue({ kind: 'unknown', answered: true, errors: [] })
    isKnownToStatusApi.mockReset().mockResolvedValue(false)
    sendAndConfirmBundle
      .mockReset()
      .mockImplementation(
        async (
          _client: unknown,
          _transactions: unknown,
          options: { onBroadcast: () => void }
        ) => {
          options.onBroadcast()
          return {
            kind: 'confirmed',
            value: {
              bundleId: 'bundle-id',
              txSignatures: [],
              signatureResults: [],
              bundleErr: { Ok: null },
            },
          }
        }
      )
  })

  it('resubmits the stored bundle once, exactly as signed, after the lookup', async () => {
    await expect(
      new SolanaJitoWaitForTransactionTask().run(
        resumeContext({ txHex: JSON.stringify(WIRES) }, Date.now())
      )
    ).resolves.toEqual({ status: 'COMPLETED' })

    // Bundles are sent once, as on the first run.
    expect(sendAndConfirmBundle).toHaveBeenCalledTimes(1)
    const [, sent] = sendAndConfirmBundle.mock.calls[0]
    expect(
      sent.map((transaction: Transaction) =>
        getBase64EncodedWireTransaction(transaction)
      )
    ).toEqual(WIRES)
    const signature = signatureFilledWith(7)
    expect(lookupSignatureStatus).toHaveBeenCalledWith(
      expect.anything(),
      signature
    )
    expect(lookupSignatureStatus.mock.invocationCallOrder[0]).toBeLessThan(
      sendAndConfirmBundle.mock.invocationCallOrder[0]
    )
    expect(updateAction.mock.calls.at(-1)?.[3]).toEqual({
      txHash: signature,
      txLink: `https://explorer/tx/${signature}`,
    })
    expect(txHexWrites()).toHaveLength(1)
  })

  it('does not resubmit a bundle whose first signature the lookup found', async () => {
    lookupSignatureStatus.mockResolvedValue({
      kind: 'found',
      status: { confirmationStatus: 'confirmed', err: null },
    })

    await expect(
      new SolanaJitoWaitForTransactionTask().run(
        resumeContext({ txHex: JSON.stringify(WIRES) }, Date.now())
      )
    ).resolves.toEqual({ status: 'COMPLETED' })

    expect(sendAndConfirmBundle).not.toHaveBeenCalled()
  })

  it('keeps the stored bundle when a resume finds no Jito RPC', async () => {
    // The configuration gap throws before anything is submitted in this
    // run, but an earlier run may have submitted the same bundle.
    const configurationGap = new RPCError(
      LiFiErrorCode.RpcUnavailable,
      'Jito bundle required, but no configured Solana RPC supports `sendBundle`. Supply a Jito-capable URL via the `rpcUrls` client config option.'
    )
    sendAndConfirmBundle.mockReset().mockRejectedValue(configurationGap)

    await expect(
      new SolanaJitoWaitForTransactionTask().run(
        resumeContext({ txHex: JSON.stringify(WIRES) }, Date.now())
      )
    ).rejects.toBe(configurationGap)

    expect(txHexWrites()).toEqual([])
  })

  it('does not resubmit a durable-nonce bundle past the resend age cap and keeps it unknown', async () => {
    const nonceWires = [
      signedNonceTransactionBase64(7),
      signedNonceTransactionBase64(8),
    ]

    const thrown = await new SolanaJitoWaitForTransactionTask()
      .run(
        resumeContext(
          { txHex: JSON.stringify(nonceWires) },
          Date.now() - MAX_RESEND_AGE_MS - 10_000
        )
      )
      .catch((e) => e)

    expect(sendAndConfirmBundle).not.toHaveBeenCalled()
    expect(thrown.code).toBe(LiFiErrorCode.TransactionExpired)
    expect(isFinalTransactionError(thrown)).toBe(false)
    expect(txHexWrites()).toEqual([])
  })
})
