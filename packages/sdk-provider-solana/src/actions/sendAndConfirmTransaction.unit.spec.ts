import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@solana/kit', async () => ({
  ...(await vi.importActual<object>('@solana/kit')),
  getBase64EncodedWireTransaction: () => 'base64-encoded-tx',
  getSignatureFromTransaction: () => 'tx-signature',
}))

const getSolanaRpcs = vi.fn()
vi.mock('../rpc/registry.js', () => ({
  getSolanaRpcs: (...args: unknown[]) => getSolanaRpcs(...args),
}))

const getTransactionLifetime = vi.fn()
vi.mock('../utils/getTransactionLifetime.js', () => ({
  getTransactionLifetime: (...args: unknown[]) =>
    getTransactionLifetime(...args),
}))

const confirmSignature = vi.fn()
vi.mock('../confirmation/confirmSignature.js', () => ({
  confirmSignature: (...args: unknown[]) => confirmSignature(...args),
}))

const { sendAndConfirmTransaction } = await import(
  './sendAndConfirmTransaction.js'
)

/**
 * A stand-in RPC that exposes `sendTransaction` and nothing else. Any attempt
 * to reach for `getLatestBlockhash` or `getBlockHeight` would throw here, so
 * this shape also pins that the confirmation horizon needs no RPC round-trip.
 */
const createRpc = () => {
  const send = vi.fn(() => Promise.resolve('ok'))
  const sendTransaction = vi.fn(() => ({ send }))
  return { send, sendTransaction }
}

describe('sendAndConfirmTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getTransactionLifetime.mockResolvedValue({ kind: 'unknown' })
    confirmSignature.mockImplementation(
      async (options: {
        rpc: unknown
        signal: AbortSignal
        resend: (rpc: unknown, signal: AbortSignal) => Promise<void>
      }) => {
        await options.resend(options.rpc, options.signal)
        return { kind: 'confirmed', value: { err: null } }
      }
    )
  })

  it('sends the transaction exactly once per RPC', async () => {
    const rpcA = createRpc()
    const rpcB = createRpc()
    getSolanaRpcs.mockResolvedValue([rpcA, rpcB])

    await sendAndConfirmTransaction({} as never, {} as never)

    // One send per RPC, and only the one inside `resend`. A second send
    // before the race would submit every transaction twice per endpoint.
    expect(rpcA.sendTransaction).toHaveBeenCalledTimes(1)
    expect(rpcB.sendTransaction).toHaveBeenCalledTimes(1)
    expect(rpcA.sendTransaction).toHaveBeenCalledWith(
      'base64-encoded-tx',
      expect.objectContaining({ skipPreflight: true, maxRetries: 0n })
    )
  })

  it('forwards the branch abort signal to send', async () => {
    const rpc = createRpc()
    getSolanaRpcs.mockResolvedValue([rpc])

    await sendAndConfirmTransaction({} as never, {} as never)

    const { signal } = confirmSignature.mock.calls[0][0]
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(rpc.send).toHaveBeenCalledWith({ abortSignal: signal })
  })

  it('derives the confirmation lifetime from the signed transaction', async () => {
    const lifetime = { kind: 'blockhash', blockhash: 'BLOCKHASH' }
    getTransactionLifetime.mockResolvedValue(lifetime)
    const rpc = createRpc()
    getSolanaRpcs.mockResolvedValue([rpc])
    const signedTransaction = { messageBytes: new Uint8Array([1]) }

    await sendAndConfirmTransaction({} as never, signedTransaction as never)

    expect(getTransactionLifetime).toHaveBeenCalledWith(signedTransaction)
    expect(confirmSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: 'tx-signature',
        lifetimes: [lifetime],
      })
    )
  })

  it('reports the broadcast once, however many branches call it', async () => {
    // Each branch's resend loop reports every accepted send; the caller's
    // callback must still fire a single time, because it drives one status
    // write in the wait task. The once-guard lives here, not in the task.
    getSolanaRpcs.mockResolvedValue([createRpc(), createRpc()])
    confirmSignature.mockImplementation(
      async (options: { onBroadcast?: () => void }) => {
        options.onBroadcast?.()
        options.onBroadcast?.()
        return { kind: 'confirmed', value: { err: null } }
      }
    )
    const onBroadcast = vi.fn()

    await sendAndConfirmTransaction({} as never, {} as never, { onBroadcast })

    expect(confirmSignature).toHaveBeenCalledTimes(2)
    expect(onBroadcast).toHaveBeenCalledTimes(1)
  })

  it('returns the raced result', async () => {
    getSolanaRpcs.mockResolvedValue([createRpc()])

    await expect(
      sendAndConfirmTransaction({} as never, {} as never)
    ).resolves.toEqual({ kind: 'confirmed', value: { err: null } })
  })
})
