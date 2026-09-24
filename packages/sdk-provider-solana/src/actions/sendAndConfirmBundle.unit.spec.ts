import { ChainId, LiFiErrorCode, RPCError } from '@lifi/sdk'
import type { Transaction } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@solana/kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@solana/kit')>()),
  getBase64EncodedWireTransaction: () => 'base64-encoded-tx',
}))

const getJitoRpcs = vi.fn()
const getJitoCapableRpcs = vi.fn()
vi.mock('../rpc/registry.js', () => ({
  getJitoRpcs: (...args: unknown[]) => getJitoRpcs(...args),
  getJitoCapableRpcs: (...args: unknown[]) => getJitoCapableRpcs(...args),
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
  })

  it('throws a configuration error, not a bare rpc-unavailable, when no Jito RPC is configured', async () => {
    // The default LI.FI Solana RPCs answer `getBundleStatuses` with "method
    // not found", so an integrator who configured nothing reaches this path
    // on every bundle route. Racing zero RPCs would produce `rpc-unavailable`
    // with an empty error list - indistinguishable from an outage - so the
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
      (options: { send: () => Promise<string> }) => options.send()
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
      send: () => Promise<string>
    }
    await expect(send()).resolves.toBe('bundle-1')
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
      async (options: { send: () => Promise<string> }) => {
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

  it('reports the broadcast once, however many branches submit successfully', async () => {
    // Two Jito RPCs both accept the submission; the caller's callback fires
    // for the first only. The once-guard lives here so the wait task's
    // status write happens a single time.
    const rpcB = {
      sendBundle: (...args: unknown[]) => ({
        send: (options: unknown) => {
          sendBundleOptions.push(options)
          return sendBundle(...args)
        },
      }),
    }
    getJitoRpcs.mockResolvedValue({ rpcs: [rpc, rpcB], unreachable: 0 })
    sendBundle.mockResolvedValue('bundle-1')
    confirmBundle.mockImplementation(
      async (options: {
        send: () => Promise<string>
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
    getJitoRpcs.mockResolvedValue({ rpcs: [rpc, { ...rpc }], unreachable: 0 })
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
    const confirmation = {
      bundleId: 'bundle-1',
      txSignatures: ['sig0', 'sig1'],
      signatureResults: [{ err: null }, { err: null }],
    }
    confirmBundle.mockResolvedValue({ kind: 'confirmed', value: confirmation })

    const result = await sendAndConfirmBundle(clientWith(), TRANSACTIONS)

    expect(result).toEqual({ kind: 'confirmed', value: confirmation })
    expect(getTransactionLifetime).toHaveBeenCalledTimes(2)
    expect(confirmBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        lifetimes: [
          { kind: 'blockhash', blockhash: 'A' },
          { kind: 'blockhash', blockhash: 'B' },
        ],
      })
    )
  })
})

describe('sendAndConfirmBundle with write RPCs', () => {
  const WRITE_URLS = ['https://write-a.example', 'https://write-b.example']

  /** A configured Jito RPC: it polls for the bundle, but must never submit it. */
  const createReadJitoRpc = () => ({
    sendBundle: vi.fn(() => {
      throw new Error(
        'a configured Jito RPC must not submit when a write RPC can'
      )
    }),
  })

  const createWriteJitoRpc = (answer: () => Promise<string>) => {
    const send = vi.fn(answer)
    return { send, sendBundle: vi.fn(() => ({ send })) }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    getTransactionLifetime.mockResolvedValue({ kind: 'unknown' })
    confirmBundle.mockImplementation(
      async (options: { send: () => Promise<string> }) => {
        const bundleId = await options.send()
        return {
          kind: 'confirmed',
          value: {
            bundleId,
            txSignatures: [],
            signatureResults: [],
            bundleErr: null,
          },
        }
      }
    )
  })

  it('submits once through the write RPCs and polls on the configured Jito RPCs', async () => {
    const readA = createReadJitoRpc()
    const readB = createReadJitoRpc()
    const write = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoRpcs.mockResolvedValue({ rpcs: [readA, readB], unreachable: 0 })
    getJitoCapableRpcs.mockResolvedValue([write])

    const result = await sendAndConfirmBundle(
      clientWith(WRITE_URLS),
      TRANSACTIONS
    )

    expect(getJitoCapableRpcs).toHaveBeenCalledWith(WRITE_URLS)
    expect(result).toMatchObject({
      kind: 'confirmed',
      value: { bundleId: 'bundle-1' },
    })
    // One submission shared by both polling branches: the bundle id is
    // derived from the transactions, so every branch polls the same bundle.
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
    getJitoRpcs.mockResolvedValue({
      rpcs: [createReadJitoRpc()],
      unreachable: 0,
    })
    getJitoCapableRpcs.mockResolvedValue([refusing, accepting])

    const result = await sendAndConfirmBundle(
      clientWith(WRITE_URLS),
      TRANSACTIONS
    )

    expect(result.kind).toBe('confirmed')
    expect(refusing.sendBundle).toHaveBeenCalledTimes(1)
    expect(accepting.sendBundle).toHaveBeenCalledTimes(1)
  })

  it('returns rpc-unavailable when every write RPC refuses the bundle', async () => {
    // The configured RPC would accept the bundle, so this only passes when the
    // submission really goes to the write RPCs.
    const acceptingRead = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoRpcs.mockResolvedValue({ rpcs: [acceptingRead], unreachable: 0 })
    getJitoCapableRpcs.mockResolvedValue([
      createWriteJitoRpc(() => Promise.reject(new Error('403'))),
    ])

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
    getJitoCapableRpcs.mockResolvedValue([])

    const thrown = await sendAndConfirmBundle(
      clientWith(WRITE_URLS),
      TRANSACTIONS
    ).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    expect(thrown.code).toBe(LiFiErrorCode.RpcUnavailable)
    expect(thrown.message).toContain('rpcUrls[ChainId.SOL]')
    expect(read.sendBundle).not.toHaveBeenCalled()
    expect(confirmBundle).not.toHaveBeenCalled()
  })

  it('names the read list when only a write RPC supports Jito', async () => {
    // The write RPC can submit, but polling needs a Jito-capable read RPC.
    // "No configured RPC supports sendBundle" would be false here.
    getJitoRpcs.mockResolvedValue({ rpcs: [], unreachable: 0 })
    getJitoCapableRpcs.mockResolvedValue([
      createWriteJitoRpc(() => Promise.resolve('bundle-1')),
    ])

    const thrown = await sendAndConfirmBundle(
      clientWith(WRITE_URLS),
      TRANSACTIONS
    ).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    expect(thrown.code).toBe(LiFiErrorCode.RpcUnavailable)
    expect(thrown.message).toContain('rpcUrls[ChainId.SOL].read')
    expect(thrown.message).not.toContain('no configured Solana RPC supports')
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
    getJitoRpcs.mockResolvedValue({
      rpcs: [createReadJitoRpc()],
      unreachable: 0,
    })
    // Both pass the Jito probe; only the bundle list may submit.
    getJitoCapableRpcs.mockImplementation(async (urls: string[]) =>
      urls === BUNDLE_URLS ? [bundleRpc] : [writeRpc]
    )

    const result = await sendAndConfirmBundle(
      clientWith(WRITE_URLS, BUNDLE_URLS),
      TRANSACTIONS
    )

    expect(result.kind).toBe('confirmed')
    expect(bundleRpc.sendBundle).toHaveBeenCalledTimes(1)
    expect(writeRpc.sendBundle).not.toHaveBeenCalled()
  })

  it('submits through the Jito-capable write RPCs when no bundle RPC passes the probe', async () => {
    const BUNDLE_URLS = ['https://bundle.example']
    const writeRpc = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoRpcs.mockResolvedValue({
      rpcs: [createReadJitoRpc()],
      unreachable: 0,
    })
    getJitoCapableRpcs.mockImplementation(async (urls: string[]) =>
      urls === BUNDLE_URLS ? [] : [writeRpc]
    )

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
    getJitoRpcs.mockResolvedValue({
      rpcs: [createReadJitoRpc()],
      unreachable: 0,
    })
    getJitoCapableRpcs.mockResolvedValue([bundleRpc])

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
    getJitoCapableRpcs.mockResolvedValue([])

    const thrown = await sendAndConfirmBundle(
      clientWith([], ['https://bundle.example']),
      TRANSACTIONS
    ).catch((e) => e)

    expect(thrown).toBeInstanceOf(RPCError)
    expect(read.sendBundle).not.toHaveBeenCalled()
  })

  it('fails when neither the bundle nor the write list passes the probe', async () => {
    const read = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoRpcs.mockResolvedValue({ rpcs: [read], unreachable: 0 })
    getJitoCapableRpcs.mockResolvedValue([])

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
    expect(read.sendBundle).not.toHaveBeenCalled()
  })

  it('does not probe write RPCs when the chain has none', async () => {
    const read = createWriteJitoRpc(() => Promise.resolve('bundle-1'))
    getJitoRpcs.mockResolvedValue({ rpcs: [read], unreachable: 0 })

    await sendAndConfirmBundle(clientWith([]), TRANSACTIONS)

    expect(getJitoCapableRpcs).not.toHaveBeenCalled()
    expect(read.sendBundle).toHaveBeenCalledTimes(1)
  })
})
