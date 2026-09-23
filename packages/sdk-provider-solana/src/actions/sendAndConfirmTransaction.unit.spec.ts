import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const getTransactionLifetime = vi.fn()
vi.mock('../utils/getTransactionLifetime.js', () => ({
  getTransactionLifetime: (...args: unknown[]) =>
    getTransactionLifetime(...args),
}))

const confirmSignature = vi.fn()
vi.mock('../confirmation/confirmSignature.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
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

  it('confirms even when the broadcast callback throws', async () => {
    // The callback reaches integrator code through `updateRouteHook`. It runs
    // after the network accepted the send, so a throw escaping into the branch
    // would reject it and report a transaction that may already have landed as
    // an RPC outage.
    getSolanaRpcs.mockResolvedValue([createRpc()])
    confirmSignature.mockImplementation(
      async (options: { onBroadcast?: () => void }) => {
        options.onBroadcast?.()
        return { kind: 'confirmed', value: { err: null } }
      }
    )
    const onBroadcast = vi.fn(() => {
      throw new Error('updateRouteHook blew up')
    })

    await expect(
      sendAndConfirmTransaction({} as never, {} as never, { onBroadcast })
    ).resolves.toEqual({ kind: 'confirmed', value: { err: null } })
    expect(onBroadcast).toHaveBeenCalledTimes(1)
  })

  it('retries the broadcast callback after one throws', async () => {
    // The once-guard latches on success only. A callback that threw wrote
    // nothing, so latching first lost the `txLink` write permanently - the
    // resend loop calls back on every accepted send and any of them will do.
    getSolanaRpcs.mockResolvedValue([createRpc()])
    confirmSignature.mockImplementation(
      async (options: { onBroadcast?: () => void }) => {
        options.onBroadcast?.()
        options.onBroadcast?.()
        options.onBroadcast?.()
        return { kind: 'confirmed', value: { err: null } }
      }
    )
    let calls = 0
    const onBroadcast = vi.fn(() => {
      calls += 1
      if (calls === 1) {
        throw new Error('transient hook failure')
      }
    })

    await sendAndConfirmTransaction({} as never, {} as never, { onBroadcast })

    // Once to fail, once to succeed, and then the guard latches for good.
    expect(onBroadcast).toHaveBeenCalledTimes(2)
  })

  it('reports rpc-unavailable when no RPC ever accepted the send', async () => {
    // Write-restricted key, or endpoints that 403 writes while answering
    // reads: every branch polls to its deadline and returns `not-confirmed`,
    // so the race verdict was TransactionExpired after 90 s - an expiry claim
    // about a transaction that was never submitted anywhere.
    getSolanaRpcs.mockResolvedValue([createRpc(), createRpc()])
    confirmSignature.mockResolvedValue({ kind: 'not-confirmed' })

    await expect(
      sendAndConfirmTransaction({} as never, {} as never)
    ).resolves.toEqual(expect.objectContaining({ kind: 'rpc-unavailable' }))
  })

  it('keeps not-confirmed when at least one RPC accepted the send', async () => {
    getSolanaRpcs.mockResolvedValue([createRpc()])
    confirmSignature.mockImplementation(
      async (options: { onBroadcast?: () => void }) => {
        options.onBroadcast?.()
        return { kind: 'not-confirmed' }
      }
    )

    await expect(
      sendAndConfirmTransaction({} as never, {} as never)
    ).resolves.toEqual(expect.objectContaining({ kind: 'not-confirmed' }))
  })

  it('keeps not-confirmed when the broadcast callback throws every time', async () => {
    // The once-guard stays open on purpose so a throwing hook can be retried.
    // It must not double as the answer to "did any RPC accept the send?": an
    // `updateRouteHook` that throws on every resend would leave it false and
    // turn a real expiry into rpc-unavailable, which is the rewrite below.
    getSolanaRpcs.mockResolvedValue([createRpc()])
    confirmSignature.mockImplementation(
      async (options: { onBroadcast?: () => void }) => {
        options.onBroadcast?.()
        options.onBroadcast?.()
        return { kind: 'not-confirmed' }
      }
    )
    const onBroadcast = vi.fn(() => {
      throw new Error('updateRouteHook blew up')
    })

    await expect(
      sendAndConfirmTransaction({} as never, {} as never, { onBroadcast })
    ).resolves.toEqual(expect.objectContaining({ kind: 'not-confirmed' }))
    // Both calls ran: the guard never latched, because neither returned.
    expect(onBroadcast).toHaveBeenCalledTimes(2)
  })

  it('returns the raced result', async () => {
    getSolanaRpcs.mockResolvedValue([createRpc()])

    await expect(
      sendAndConfirmTransaction({} as never, {} as never)
    ).resolves.toEqual({ kind: 'confirmed', value: { err: null } })
  })
})

describe('sendAndConfirmTransaction with writeRpcUrls', () => {
  const WRITE_URLS = ['https://write-a.example', 'https://write-b.example']

  /** A read RPC: the confirmation branch runs on it, but it must never send. */
  const createReadRpc = () => ({
    sendTransaction: vi.fn(() => {
      throw new Error('a read RPC must not send when writeRpcUrls is set')
    }),
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    getTransactionLifetime.mockResolvedValue({ kind: 'unknown' })
    confirmSignature.mockImplementation(
      async (options: {
        rpc: unknown
        signal: AbortSignal
        resend: (rpc: unknown, signal: AbortSignal) => Promise<void>
        onBroadcast?: () => void
      }) => {
        await options.resend(options.rpc, options.signal)
        options.onBroadcast?.()
        return { kind: 'confirmed', value: { err: null } }
      }
    )
  })

  it('sends through every write RPC and never through a read RPC', async () => {
    const read = createReadRpc()
    const writeA = createRpc()
    const writeB = createRpc()
    getSolanaRpcs.mockResolvedValue([read])
    getSolanaWriteRpcs.mockReturnValue([writeA, writeB])

    const result = await sendAndConfirmTransaction({} as never, {} as never, {
      writeRpcUrls: WRITE_URLS,
    })

    expect(result).toEqual({ kind: 'confirmed', value: { err: null } })
    expect(getSolanaWriteRpcs).toHaveBeenCalledWith(WRITE_URLS)
    expect(writeA.sendTransaction).toHaveBeenCalledWith(
      'base64-encoded-tx',
      expect.objectContaining({ skipPreflight: true, maxRetries: 0n })
    )
    expect(writeB.sendTransaction).toHaveBeenCalledTimes(1)
    expect(read.sendTransaction).not.toHaveBeenCalled()
  })

  it('sends once when several confirmation branches resend at the same time', async () => {
    // Every read RPC runs its own confirmation branch, and each branch resends
    // about once a second. Without a shared sender, three read RPCs would hit
    // each write RPC three times a second.
    const write = createRpc()
    getSolanaRpcs.mockResolvedValue([
      createReadRpc(),
      createReadRpc(),
      createReadRpc(),
    ])
    getSolanaWriteRpcs.mockReturnValue([write])

    await sendAndConfirmTransaction({} as never, {} as never, {
      writeRpcUrls: WRITE_URLS,
    })

    expect(write.sendTransaction).toHaveBeenCalledTimes(1)
  })

  it('sends again once the resend interval has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const write = createRpc()
    getSolanaRpcs.mockResolvedValue([createReadRpc()])
    getSolanaWriteRpcs.mockReturnValue([write])
    confirmSignature.mockImplementation(
      async (options: {
        rpc: unknown
        signal: AbortSignal
        resend: (rpc: unknown, signal: AbortSignal) => Promise<void>
      }) => {
        await options.resend(options.rpc, options.signal)
        vi.setSystemTime(Date.now() + 500)
        await options.resend(options.rpc, options.signal)
        vi.setSystemTime(Date.now() + 500)
        await options.resend(options.rpc, options.signal)
        return { kind: 'confirmed', value: { err: null } }
      }
    )

    await sendAndConfirmTransaction({} as never, {} as never, {
      writeRpcUrls: WRITE_URLS,
    })

    // t=0 sends, t=500 shares it, t=1000 sends again.
    expect(write.sendTransaction).toHaveBeenCalledTimes(2)
  })

  it('reports rpc-unavailable when every write RPC refuses the send', async () => {
    // The read RPCs would accept the send, so this only passes when the send
    // really goes to the write RPCs.
    const refusing = {
      sendTransaction: vi.fn(() => ({
        send: vi.fn(() => Promise.reject(new Error('403'))),
      })),
    }
    getSolanaRpcs.mockResolvedValue([createRpc()])
    getSolanaWriteRpcs.mockReturnValue([refusing])
    confirmSignature.mockImplementation(
      async (options: {
        rpc: unknown
        signal: AbortSignal
        resend: (rpc: unknown, signal: AbortSignal) => Promise<void>
        onBroadcast?: () => void
      }) => {
        try {
          await options.resend(options.rpc, options.signal)
          options.onBroadcast?.()
        } catch (_) {
          // A refused send is best-effort inside confirmSignature.
        }
        return { kind: 'not-confirmed' }
      }
    )

    await expect(
      sendAndConfirmTransaction({} as never, {} as never, {
        writeRpcUrls: WRITE_URLS,
      })
    ).resolves.toEqual(expect.objectContaining({ kind: 'rpc-unavailable' }))
  })

  it('keeps a shared send open when the branch that started it ends', async () => {
    // Other branches wait on the same send, so it must not ride on the
    // signal of whichever branch happened to start it.
    let writeSignal: AbortSignal | undefined
    const write = {
      sendTransaction: vi.fn(() => ({
        send: vi.fn((options: { abortSignal: AbortSignal }) => {
          writeSignal = options.abortSignal
          return Promise.resolve('ok')
        }),
      })),
    }
    getSolanaRpcs.mockResolvedValue([createReadRpc()])
    getSolanaWriteRpcs.mockReturnValue([write])
    let abortedWhenBranchEnded: boolean | undefined
    confirmSignature.mockImplementation(
      async (options: {
        rpc: unknown
        resend: (rpc: unknown, signal: AbortSignal) => Promise<void>
      }) => {
        const branch = new AbortController()
        const sending = options.resend(options.rpc, branch.signal)
        branch.abort()
        abortedWhenBranchEnded = writeSignal?.aborted
        await sending
        return { kind: 'confirmed', value: { err: null } }
      }
    )

    await sendAndConfirmTransaction({} as never, {} as never, {
      writeRpcUrls: WRITE_URLS,
    })

    expect(abortedWhenBranchEnded).toBe(false)
    // It ends with the whole call instead.
    expect(writeSignal?.aborted).toBe(true)
  })

  it('sends through the read RPCs when writeRpcUrls is empty', async () => {
    const read = createRpc()
    getSolanaRpcs.mockResolvedValue([read])

    await sendAndConfirmTransaction({} as never, {} as never, {
      writeRpcUrls: [],
    })

    expect(getSolanaWriteRpcs).not.toHaveBeenCalled()
    expect(read.sendTransaction).toHaveBeenCalledTimes(1)
  })
})
