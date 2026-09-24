import { ChainId } from '@lifi/sdk'
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

/** A client whose Solana `rpcUrls` entry has the given write list. */
const clientWith = (writeRpcUrls: string[] = []) =>
  ({
    getWriteRpcUrlsByChainId: vi.fn(async (chainId: number) =>
      chainId === ChainId.SOL ? writeRpcUrls : []
    ),
  }) as never

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

    const result = await sendAndConfirmTransaction(
      clientWith(['https://write.example']),
      {} as never
    )

    expect(result).toMatchObject({ kind: 'confirmed' })
    // The send was still open when the race ended, and ended with it.
    expect(write.signals.length).toBeGreaterThan(0)
    expect(write.signals.every((signal) => signal.aborted)).toBe(true)
  }, 5_000)

  /** A write RPC that accepts each send after `ms`, whatever its signal says. */
  const slowWriteRpc = (ms: number) => ({
    sendTransaction: () => ({
      send: () => new Promise((resolve) => setTimeout(() => resolve('ok'), ms)),
    }),
  })

  /** A read RPC that reports the transaction confirmed after `ms`. */
  const readRpcConfirmingAfter = (ms: number) => {
    const start = Date.now()
    return {
      getSignatureStatuses: () => ({
        send: () =>
          Promise.resolve({
            value: [
              Date.now() - start >= ms
                ? { confirmationStatus: 'confirmed', err: null, slot: 1n }
                : null,
            ],
          }),
      }),
    }
  }

  it('reports a write RPC that accepts after the branch stopped waiting', async () => {
    // The branch gives up on the send after one interval and polls. The
    // acceptance lands later, while the race still runs, so only the
    // call-wide recorder can report it.
    getSolanaRpcs.mockResolvedValue([readRpcConfirmingAfter(1_600)])
    getSolanaWriteRpcs.mockReturnValue([slowWriteRpc(1_200)])
    const onBroadcast = vi.fn()

    const result = await sendAndConfirmTransaction(
      clientWith(['https://write.example']),
      {} as never,
      { onBroadcast }
    )

    expect(result).toMatchObject({ kind: 'confirmed' })
    expect(onBroadcast).toHaveBeenCalledTimes(1)
  }, 5_000)

  it('does not report an acceptance that lands after the race is over', async () => {
    // A late report would regress an action status the wait task already
    // finalized.
    getSolanaRpcs.mockResolvedValue([confirmingReadRpc()])
    getSolanaWriteRpcs.mockReturnValue([slowWriteRpc(1_400)])
    const onBroadcast = vi.fn()

    await sendAndConfirmTransaction(
      clientWith(['https://write.example']),
      {} as never,
      { onBroadcast }
    )
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(onBroadcast).not.toHaveBeenCalled()
  }, 5_000)
})
