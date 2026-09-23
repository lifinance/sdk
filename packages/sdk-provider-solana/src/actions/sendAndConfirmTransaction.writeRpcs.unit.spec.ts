import { describe, expect, it, vi } from 'vitest'

// Runs the real confirmation loop (`confirmSignature`, `raceRpcs`,
// `pollUntilDeadline`). The main spec mocks `confirmSignature`, so it cannot
// see how a slow write RPC holds up polling.

vi.mock('@solana/kit', async () => ({
  ...(await vi.importActual<object>('@solana/kit')),
  getBase64EncodedWireTransaction: () => 'base64-encoded-tx',
  getSignatureFromTransaction: () => 'tx-signature',
}))

const getSolanaRpcs = vi.fn()
const getSolanaWriteRpcs = vi.fn()
vi.mock('../rpc/registry.js', () => ({
  getSolanaRpcs: (...args: unknown[]) => getSolanaRpcs(...args),
  getSolanaWriteRpcs: (...args: unknown[]) => getSolanaWriteRpcs(...args),
}))

// An unknown lifetime keeps the deadline on the wall clock, so the read RPC
// below only has to answer status reads.
vi.mock('../utils/getTransactionLifetime.js', () => ({
  getTransactionLifetime: async () => ({ kind: 'unknown' }),
}))

const { sendAndConfirmTransaction } = await import(
  './sendAndConfirmTransaction.js'
)

/** A read RPC that reports the transaction confirmed on the first read. */
const confirmingReadRpc = () => ({
  getSignatureStatuses: () => ({
    send: () =>
      Promise.resolve({
        value: [{ confirmationStatus: 'confirmed', err: null, slot: 1n }],
      }),
  }),
})

/** A write RPC whose send never settles until its signal aborts. */
const hangingWriteRpc = () => {
  const signals: AbortSignal[] = []
  return {
    signals,
    sendTransaction: () => ({
      send: ({ abortSignal }: { abortSignal: AbortSignal }) => {
        signals.push(abortSignal)
        return new Promise((_resolve, reject) => {
          abortSignal.addEventListener('abort', () =>
            reject(new Error('aborted'))
          )
        })
      },
    }),
  }
}

describe('sendAndConfirmTransaction with a slow write RPC', () => {
  it('confirms from the read RPCs while the write RPC has not answered', async () => {
    const write = hangingWriteRpc()
    getSolanaRpcs.mockResolvedValue([confirmingReadRpc()])
    getSolanaWriteRpcs.mockReturnValue([write])

    const result = await sendAndConfirmTransaction({} as never, {} as never, {
      writeRpcUrls: ['https://write.example'],
    })

    expect(result).toMatchObject({ kind: 'confirmed' })
    // The send was still open when the race ended, and ended with it.
    expect(write.signals.length).toBeGreaterThan(0)
    expect(write.signals.every((signal) => signal.aborted)).toBe(true)
  }, 5_000)
})
