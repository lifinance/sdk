import { ChainId, LiFiErrorCode, RPCError } from '@lifi/sdk'
import type { Transaction } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@solana/kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@solana/kit')>()),
  getBase64EncodedWireTransaction: () => 'base64-encoded-tx',
  getSignatureFromTransaction: () => 'signature',
}))

const getJitoRpcs = vi.fn()
const getJitoCapableRpcs = vi.fn()
const getSolanaRpcs = vi.fn()
vi.mock('../rpc/registry.js', () => ({
  getJitoRpcs: (...args: unknown[]) => getJitoRpcs(...args),
  getJitoCapableRpcs: (...args: unknown[]) => getJitoCapableRpcs(...args),
  getSolanaRpcs: (...args: unknown[]) => getSolanaRpcs(...args),
}))

const getTransactionLifetime = vi.fn()
vi.mock('../utils/getTransactionLifetime.js', () => ({
  getTransactionLifetime: (...args: unknown[]) =>
    getTransactionLifetime(...args),
}))

const confirmBundle = vi.fn()
vi.mock('../confirmation/confirmBundle.js', () => ({
  confirmBundle: (...args: unknown[]) => confirmBundle(...args),
}))

const { sendAndConfirmBundle } = await import('./sendAndConfirmBundle.js')

/** A client whose Solana `rpcUrls` entry has the given write and bundle lists. */
const clientWith = (
  writeRpcUrls: string[] = [],
  bundleRpcUrls: string[] = []
) =>
  ({
    getWriteRpcUrlsByChainId: vi.fn(async (chainId: number) =>
      chainId === ChainId.SOL ? writeRpcUrls : []
    ),
    getBundleRpcUrlsByChainId: vi.fn(async (chainId: number) =>
      chainId === ChainId.SOL ? bundleRpcUrls : []
    ),
  }) as never

const sendBundle = vi.fn()
/** Options every `sendBundle(...).send(...)` call received. */
const sendBundleOptions: unknown[] = []
const rpc = {
  sendBundle: (...args: unknown[]) => ({
    send: (options: unknown) => {
      sendBundleOptions.push(options)
      return sendBundle(...args)
    },
  }),
}

const TRANSACTIONS = [{}, {}] as Transaction[]

describe('sendAndConfirmBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendBundleOptions.length = 0
    getTransactionLifetime.mockResolvedValue({ kind: 'unknown' })
    getSolanaRpcs.mockResolvedValue([{}])
  })

  it('throws a configuration error, not a bare rpc-unavailable, when no Jito RPC is configured', async () => {
    // The default LI.FI Solana RPCs answer `getBundleStatuses` with "method
    // not found", so an integrator who configured nothing reaches this path
    // on every bundle route. Submitting to zero RPCs would make every branch
    // fail with no usable error - indistinguishable from an outage - so the
    // configuration gap must be named before anything is raced.
    getJitoRpcs.mockResolvedValue({ rpcs: [], unreachable: 0 })

    const thrown = await sendAndConfirmBundle(clientWith(), TRANSACTIONS).catch(
      (e) => e
    )

    expect(thrown).toBeInstanceOf(RPCError)
    expect(LiFiErrorCode.RpcUnavailable).toBe(1027)
    expect(thrown.code).toBe(LiFiErrorCode.RpcUnavailable)
    expect(thrown.message).toContain('no configured Solana RPC supports')
    expect(thrown.message).toContain('rpcUrls')
    expect(confirmBundle).not.toHaveBeenCalled()
  })

  it('blames an outage, not the configuration, when the probe never answered', async () => {
    // `probeJitoRpc` reports `unreachable` for an endpoint that failed without
    // saying the method was unknown - a 429, a timeout, a 5xx. Sending that
    // integrator after their `rpcUrls` config points them at a setting that is
    // already correct while the real problem is transient.
    getJitoRpcs.mockResolvedValue({ rpcs: [], unreachable: 2 })

    const thrown = await sendAndConfirmBundle(clientWith(), TRANSACTIONS).catch(
      (e) => e
    )

    expect(thrown).toBeInstanceOf(RPCError)
    expect(thrown.code).toBe(LiFiErrorCode.RpcUnavailable)
    expect(thrown.message).toContain('2 configured Solana RPC(s)')
    expect(thrown.message).toContain('retry')
    expect(thrown.message).not.toContain('rpcUrls')
    // A bare HTTP 401/403 now classifies as `unreachable`, because it never
    // reached the JSON-RPC layer and so proves nothing about capability. A
    // real plan gate answers the same way, so this message has to cover both
    // causes - "retry" alone would loop an integrator forever on a gate that
    // no retry can clear.
    expect(thrown.message).toContain('plan')
    expect(confirmBundle).not.toHaveBeenCalled()
  })

  it('returns rpc-unavailable when sendBundle throws on every RPC', async () => {
    getJitoRpcs.mockResolvedValue({ rpcs: [rpc], unreachable: 0 })
    sendBundle.mockRejectedValue(new Error('jito rejected the bundle'))
    // `confirmBundle` owns the submission now, so the failure surfaces through
    // the callback it was handed.
    confirmBundle.mockImplementation(
      (options: { send: () => Promise<unknown> }) => options.send()
    )

    const result = await sendAndConfirmBundle(clientWith(), TRANSACTIONS)

    expect(result.kind).toBe('rpc-unavailable')
    if (result.kind !== 'rpc-unavailable') {
      throw new Error('unreachable')
    }
    expect(result.errors[0].message).toBe('jito rejected the bundle')
  })

  it('hands the submission to confirmBundle instead of sending first', async () => {
    // The deadline is built inside `confirmBundle`, on the same clock as
    // `BRANCH_TIMEOUT_MS`. Submitting here first would spend part of that
    // budget before the deadline exists.
    getJitoRpcs.mockResolvedValue({ rpcs: [rpc], unreachable: 0 })
    sendBundle.mockResolvedValue('bundle-1')
    confirmBundle.mockResolvedValue({ kind: 'not-confirmed' })

    await sendAndConfirmBundle(clientWith(), TRANSACTIONS)

    expect(confirmBundle).toHaveBeenCalledTimes(1)
    expect(sendBundle).not.toHaveBeenCalled()

    const { send } = confirmBundle.mock.calls[0][0] as {
      send: () => Promise<unknown>
    }
    await send()
    expect(sendBundle).toHaveBeenCalledWith([
      'base64-encoded-tx',
      'base64-encoded-tx',
    ])
  })

  it('forwards the branch abort signal to the bundle submission', async () => {
    // `BRANCH_TIMEOUT_MS` can only end a hung `sendBundle` through this
    // signal. It must be the branch's own signal, by identity - the one
    // `raceRpcs` hands to the branch and later aborts.
    getJitoRpcs.mockResolvedValue({ rpcs: [rpc], unreachable: 0 })
    sendBundle.mockResolvedValue('bundle-1')
    confirmBundle.mockImplementation(
      async (options: { send: () => Promise<unknown> }) => {
        await options.send()
        return { kind: 'not-confirmed' }
      }
    )

    await sendAndConfirmBundle(clientWith(), TRANSACTIONS)

    const { signal } = confirmBundle.mock.calls[0][0] as {
      signal: AbortSignal
    }
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(sendBundleOptions).toEqual([{ abortSignal: signal }])
  })

  it('reports the broadcast once, however many branches see the submission', async () => {
    // Two read RPCs confirm and share one submission; the caller's callback
    // fires for the first branch only. The once-guard lives here so the wait
    // task's status write happens a single time.
    getJitoRpcs.mockResolvedValue({ rpcs: [rpc], unreachable: 0 })
    getSolanaRpcs.mockResolvedValue([{}, {}])
    sendBundle.mockResolvedValue('bundle-1')
    confirmBundle.mockImplementation(
      async (options: {
        send: () => Promise<unknown>
        onBroadcast: () => void
      }) => {
        await options.send()
        options.onBroadcast()
        return { kind: 'not-confirmed' }
      }
    )
    const onBroadcast = vi.fn()

    await sendAndConfirmBundle(clientWith(), TRANSACTIONS, { onBroadcast })

    expect(confirmBundle).toHaveBeenCalledTimes(2)
    expect(onBroadcast).toHaveBeenCalledTimes(1)
  })

  it('confirms even when the broadcast callback throws', async () => {
    // `confirmBundle` calls the callback unguarded, straight after `sendBundle`
    // resolved. A throw escaping into that branch would reject it, and
    // `raceRpcs` would bucket a bundle Jito had already accepted as an outage.
    confirmBundle.mockImplementation(
      async (options: { onBroadcast: () => void }) => {
        options.onBroadcast()
        return { kind: 'confirmed', value: { signatureResults: [] } }
      }
    )
    getJitoRpcs.mockResolvedValue({ rpcs: [rpc], unreachable: 0 })
    getSolanaRpcs.mockResolvedValue([{}, {}])
    const onBroadcast = vi.fn(() => {
      throw new Error('updateRouteHook blew up')
    })

    await expect(
      sendAndConfirmBundle(clientWith(), TRANSACTIONS, { onBroadcast })
    ).resolves.toEqual({
      kind: 'confirmed',
      value: { signatureResults: [] },
    })
    // Attempted on both branches: the once-guard latches only after the
    // callback returns, so a callback that has never succeeded has never
    // written the `txLink` and the next branch is still allowed to try.
    expect(onBroadcast).toHaveBeenCalledTimes(2)
  })

  it('passes the lifetime of every signed transaction, not just the first', async () => {
    getJitoRpcs.mockResolvedValue({ rpcs: [rpc], unreachable: 0 })
    sendBundle.mockResolvedValue('bundle-1')
    getTransactionLifetime
      .mockResolvedValueOnce({ kind: 'blockhash', blockhash: 'A' })
      .mockResolvedValueOnce({ kind: 'blockhash', blockhash: 'B' })
    const confirmation = { signatureResults: [{ err: null }, { err: null }] }
    confirmBundle.mockResolvedValue({ kind: 'confirmed', value: confirmation })

    const result = await sendAndConfirmBundle(clientWith(), TRANSACTIONS)

    expect(result).toEqual({ kind: 'confirmed', value: confirmation })
    expect(getTransactionLifetime).toHaveBeenCalledTimes(2)
    expect(confirmBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        signatures: ['signature', 'signature'],
        lifetimes: [
          { kind: 'blockhash', blockhash: 'A' },
          { kind: 'blockhash', blockhash: 'B' },
        ],
      })
    )
  })

  it('confirms on every read RPC, not only the Jito-capable ones', async () => {
    // Plain read RPCs: a `sendBundle` on one would mean a branch submits.
    const reads = [{ sendBundle: vi.fn() }, { sendBundle: vi.fn() }]
    getJitoRpcs.mockResolvedValue({ rpcs: [rpc], unreachable: 0 })
    getSolanaRpcs.mockResolvedValue(reads)
    sendBundle.mockResolvedValue('bundle-1')
    confirmBundle.mockImplementation(
      async (options: { send: () => Promise<unknown> }) => {
        await options.send()
        return { kind: 'not-confirmed' }
      }
    )

    await sendAndConfirmBundle(clientWith(), TRANSACTIONS)

    expect(
      confirmBundle.mock.calls.map((call) => (call[0] as { rpc: unknown }).rpc)
    ).toEqual(reads)
    // The Jito-capable read RPC submits once, for both branches.
    expect(sendBundle).toHaveBeenCalledTimes(1)
    for (const read of reads) {
      expect(read.sendBundle).not.toHaveBeenCalled()
    }
  })

  it('passes an expired verdict through', async () => {
    getJitoRpcs.mockResolvedValue({ rpcs: [rpc], unreachable: 0 })
    confirmBundle.mockResolvedValue({ kind: 'expired', slot: 900n })

    await expect(
      sendAndConfirmBundle(clientWith(), TRANSACTIONS)
    ).resolves.toEqual({ kind: 'expired', slot: 900n, errors: [] })
  })
})

describe('sendAndConfirmBundle with write RPCs', () => {
  const WRITE_URLS = ['https://write-a.example', 'https://write-b.example']

  /** A read RPC: it confirms the bundle, but must never submit it. */
  const createReadRpc = () => ({
    sendBundle: vi.fn(() => {
      throw new Error('a read RPC must not submit a bundle')
    }),
  })

  const createWriteJitoRpc = (answer: () => Promise<string>) => {
    const send = vi.fn(answer)
    return { send, sendBundle: vi.fn(() => ({ send })) }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    getTransactionLifetime.mockResolvedValue({ kind: 'unknown' })
    getSolanaRpcs.mockResolvedValue([{}])
    confirmBundle.mockImplementation(
      async (options: { send: () => Promise<unknown> }) => {
        await options.send()
        return { kind: 'confirmed', value: { signatureResults: [] } }
      }
    )
  })

  it('submits once through the write RPCs and confirms on every read RPC', async () => {
    const readA = createReadRpc()
    const readB = createReadRpc()
    const write = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getSolanaRpcs.mockResolvedValue([readA, readB])
    getJitoCapableRpcs.mockResolvedValue({ rpcs: [write], unreachable: 0 })

    const result = await sendAndConfirmBundle(
      clientWith(WRITE_URLS),
      TRANSACTIONS
    )

    expect(getJitoCapableRpcs).toHaveBeenCalledWith(WRITE_URLS)
    // With a write list, the read RPCs need no Jito probe.
    expect(getJitoRpcs).not.toHaveBeenCalled()
    expect(result.kind).toBe('confirmed')
    // One submission shared by both confirming branches.
    expect(write.sendBundle).toHaveBeenCalledTimes(1)
    expect(write.sendBundle).toHaveBeenCalledWith([
      'base64-encoded-tx',
      'base64-encoded-tx',
    ])
    expect(readA.sendBundle).not.toHaveBeenCalled()
    expect(readB.sendBundle).not.toHaveBeenCalled()
    expect(
      confirmBundle.mock.calls.map((call) => (call[0] as { rpc: unknown }).rpc)
    ).toEqual([readA, readB])
  })

  it('submits through every Jito-capable write RPC and takes the first acceptance', async () => {
    const refusing = createWriteJitoRpc(() => Promise.reject(new Error('403')))
    const accepting = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoCapableRpcs.mockResolvedValue({
      rpcs: [refusing, accepting],
      unreachable: 0,
    })

    const result = await sendAndConfirmBundle(
      clientWith(WRITE_URLS),
      TRANSACTIONS
    )

    expect(result.kind).toBe('confirmed')
    expect(refusing.sendBundle).toHaveBeenCalledTimes(1)
    expect(accepting.sendBundle).toHaveBeenCalledTimes(1)
  })

  it('returns rpc-unavailable when every write RPC refuses the bundle', async () => {
    // A read RPC that would accept the bundle confirms only, so this passes
    // only when the submission really goes to the write RPCs.
    const acceptingRead = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getSolanaRpcs.mockResolvedValue([acceptingRead])
    getJitoCapableRpcs.mockResolvedValue({
      rpcs: [createWriteJitoRpc(() => Promise.reject(new Error('403')))],
      unreachable: 0,
    })

    const result = await sendAndConfirmBundle(
      clientWith(WRITE_URLS),
      TRANSACTIONS
    )

    expect(result.kind).toBe('rpc-unavailable')
    expect(acceptingRead.sendBundle).not.toHaveBeenCalled()
    // The write RPC's own refusal, as a single configured RPC would report
    // it - not a nested AggregateError.
    if (result.kind !== 'rpc-unavailable') {
      throw new Error('unreachable')
    }
    expect(result.errors[0].message).toBe('403')
  })

  it('fails instead of using the read RPCs when no write RPC passes the probe', async () => {
    // With a write list set, bundles never go to the read RPCs - even when
    // those could take the bundle.
    const read = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoRpcs.mockResolvedValue({ rpcs: [read], unreachable: 0 })
    getJitoCapableRpcs.mockResolvedValue({ rpcs: [], unreachable: 0 })

    const thrown = await sendAndConfirmBundle(
      clientWith(WRITE_URLS),
      TRANSACTIONS
    ).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    expect(thrown.code).toBe(LiFiErrorCode.RpcUnavailable)
    expect(thrown.message).toContain('rpcUrls[ChainId.SOL]')
    // With a list set, the read RPCs are not even probed for Jito.
    expect(getJitoRpcs).not.toHaveBeenCalled()
    expect(read.sendBundle).not.toHaveBeenCalled()
    expect(confirmBundle).not.toHaveBeenCalled()
  })

  it('submits through the read Jito RPCs with a client that has no write RPC lookup', async () => {
    const read = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoRpcs.mockResolvedValue({ rpcs: [read], unreachable: 0 })

    await sendAndConfirmBundle({} as never, TRANSACTIONS)

    expect(getJitoCapableRpcs).not.toHaveBeenCalled()
    expect(read.sendBundle).toHaveBeenCalledTimes(1)
  })

  it('submits through the bundle RPCs, not the write RPCs, when both are set', async () => {
    const BUNDLE_URLS = ['https://bundle.example']
    const bundleRpc = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    const writeRpc = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    // Both pass the Jito probe; only the bundle list may submit.
    getJitoCapableRpcs.mockImplementation(async (urls: string[]) => ({
      rpcs: urls === BUNDLE_URLS ? [bundleRpc] : [writeRpc],
      unreachable: 0,
    }))

    const result = await sendAndConfirmBundle(
      clientWith(WRITE_URLS, BUNDLE_URLS),
      TRANSACTIONS
    )

    expect(result.kind).toBe('confirmed')
    expect(bundleRpc.sendBundle).toHaveBeenCalledTimes(1)
    expect(writeRpc.sendBundle).not.toHaveBeenCalled()
    // With a list set, the read RPCs are not probed for Jito.
    expect(getJitoRpcs).not.toHaveBeenCalled()
  })

  it('submits through the Jito-capable write RPCs when no bundle RPC passes the probe', async () => {
    const BUNDLE_URLS = ['https://bundle.example']
    const writeRpc = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoCapableRpcs.mockImplementation(async (urls: string[]) => ({
      rpcs: urls === BUNDLE_URLS ? [] : [writeRpc],
      unreachable: 0,
    }))

    const result = await sendAndConfirmBundle(
      clientWith(WRITE_URLS, BUNDLE_URLS),
      TRANSACTIONS
    )

    expect(result.kind).toBe('confirmed')
    expect(writeRpc.sendBundle).toHaveBeenCalledTimes(1)
  })

  it('does not probe the write RPCs when a bundle RPC passes the probe', async () => {
    const BUNDLE_URLS = ['https://bundle.example']
    const bundleRpc = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoCapableRpcs.mockResolvedValue({ rpcs: [bundleRpc], unreachable: 0 })

    await sendAndConfirmBundle(
      clientWith(WRITE_URLS, BUNDLE_URLS),
      TRANSACTIONS
    )

    // The write list is only a fallback, so its probe would be wasted work
    // on the latency path before submission.
    expect(getJitoCapableRpcs).toHaveBeenCalledTimes(1)
    expect(getJitoCapableRpcs).toHaveBeenCalledWith(BUNDLE_URLS)
  })

  it('fails instead of using the read RPCs when no bundle RPC passes the probe and there is no write list', async () => {
    const read = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoRpcs.mockResolvedValue({ rpcs: [read], unreachable: 0 })
    getJitoCapableRpcs.mockResolvedValue({ rpcs: [], unreachable: 0 })

    const thrown = await sendAndConfirmBundle(
      clientWith([], ['https://bundle.example']),
      TRANSACTIONS
    ).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    // With a list set, the read RPCs are not even probed for Jito.
    expect(getJitoRpcs).not.toHaveBeenCalled()
    expect(read.sendBundle).not.toHaveBeenCalled()
  })

  it('fails when neither the bundle nor the write list passes the probe', async () => {
    const read = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoRpcs.mockResolvedValue({ rpcs: [read], unreachable: 0 })
    getJitoCapableRpcs.mockResolvedValue({ rpcs: [], unreachable: 0 })

    const thrown = await sendAndConfirmBundle(
      clientWith(WRITE_URLS, ['https://bundle.example']),
      TRANSACTIONS
    ).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    // Both lists were tried, bundle first.
    expect(getJitoCapableRpcs.mock.calls).toEqual([
      [['https://bundle.example']],
      [WRITE_URLS],
    ])
    expect(thrown.message).toContain(
      '`rpcUrls[ChainId.SOL].bundle` or `rpcUrls[ChainId.SOL].write`'
    )
    // With a list set, the read RPCs are not even probed for Jito.
    expect(getJitoRpcs).not.toHaveBeenCalled()
    expect(read.sendBundle).not.toHaveBeenCalled()
  })

  it('hands the shared submission the branch signal, so a hung endpoint can be aborted', async () => {
    // confirmBundle awaits the submission before it polls. Without the signal,
    // BRANCH_TIMEOUT_MS could not end a submission to a hung write RPC.
    const write = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoCapableRpcs.mockResolvedValue({ rpcs: [write], unreachable: 0 })

    await sendAndConfirmBundle(clientWith(WRITE_URLS), TRANSACTIONS)

    const { signal } = confirmBundle.mock.calls[0][0] as { signal: AbortSignal }
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(write.send).toHaveBeenCalledWith({ abortSignal: signal })
  })

  it('does not ask for a retry when the listed URLs do not support bundles', async () => {
    getJitoCapableRpcs.mockResolvedValue({ rpcs: [], unreachable: 0 })

    const thrown = await sendAndConfirmBundle(
      clientWith([], ['https://bundle.example']),
      TRANSACTIONS
    ).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    // Only the list that is set is named, and no retry is promised for an
    // answer that never changes.
    expect(thrown.message).toBe(
      'Jito bundle required, but no URL in `rpcUrls[ChainId.SOL].bundle` passed the Jito capability probe. They do not support `sendBundle`: add a Jito-capable URL to `rpcUrls[ChainId.SOL].bundle`. Bundles never go to the read RPCs while `bundle` or `write` is set.'
    )
  })

  it('asks for a retry when only the bundle list probe failed and the write list is unsupported', async () => {
    const BUNDLE_URLS = ['https://bundle.example']
    getJitoCapableRpcs.mockImplementation(async (urls: string[]) => ({
      rpcs: [],
      unreachable: urls === BUNDLE_URLS ? 1 : 0,
    }))

    const thrown = await sendAndConfirmBundle(
      clientWith(WRITE_URLS, BUNDLE_URLS),
      TRANSACTIONS
    ).catch((e) => e)

    expect(thrown.message).toContain('retry')
  })

  it('asks for a retry when the probe of a listed URL failed', async () => {
    getJitoCapableRpcs.mockResolvedValue({ rpcs: [], unreachable: 1 })

    const thrown = await sendAndConfirmBundle(
      clientWith(WRITE_URLS),
      TRANSACTIONS
    ).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    expect(thrown.message).toContain('rpcUrls[ChainId.SOL].write')
    expect(thrown.message).not.toContain('.bundle')
    expect(thrown.message).toContain('retry')
  })

  it('does not probe write RPCs when the chain has none', async () => {
    const read = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoRpcs.mockResolvedValue({ rpcs: [read], unreachable: 0 })

    await sendAndConfirmBundle(clientWith([]), TRANSACTIONS)

    expect(getJitoCapableRpcs).not.toHaveBeenCalled()
    expect(read.sendBundle).toHaveBeenCalledTimes(1)
  })
})
