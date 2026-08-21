import { beforeEach, describe, expect, it, vi } from 'vitest'

const getBundleStatuses = vi.fn()
const createJitoRpc = vi.fn((..._args: unknown[]) => ({
  getBundleStatuses: (...args: unknown[]) => ({
    send: () => getBundleStatuses(...args),
  }),
}))

vi.mock('./jito/createJitoRpc.js', () => ({
  createJitoRpc: (...args: unknown[]) => createJitoRpc(...args),
}))

const { probeJitoRpc } = await import('./registry.js')

describe('probeJitoRpc', () => {
  beforeEach(() => {
    getBundleStatuses.mockReset()
  })

  it('reports supported when the endpoint answers', async () => {
    getBundleStatuses.mockResolvedValue({ value: [null] })

    await expect(probeJitoRpc('https://jito.example')).resolves.toBe(
      'supported'
    )

    // A single well-formed id, never an empty array, which a Jito RPC could
    // reject as invalid. Valid as both hex and base-58 so no provider rejects
    // it on format.
    const probeArg = getBundleStatuses.mock.calls[0][0] as string[]
    expect(probeArg).toHaveLength(1)
    expect(probeArg[0]).toHaveLength(64)
    expect(probeArg[0]).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/)
  })

  it.each([
    ['a message', new Error('Method not found')],
    ['a lowercase message', new Error('method not found: getBundleStatuses')],
    [
      'a bare JSON-RPC code',
      Object.assign(new Error('boom'), { code: -32601 }),
    ],
    [
      // The exact shape `@solana/kit` throws, captured from a live call to
      // both default LI.FI endpoints. `error.code` is undefined on these - the
      // code lives on `context.__code` - so a classifier reading only `.code`
      // falls through to the message regex and survives on wording alone.
      'a SolanaError context code',
      Object.assign(
        new Error(
          'JSON-RPC error: The method does not exist / is not available (Method not found)'
        ),
        {
          name: 'SolanaError',
          context: { __code: -32601, __serverMessage: 'Method not found' },
        }
      ),
    ],
    [
      // Same context code, message reworded as a provider might localize it.
      // Only the structured signal can classify this one.
      'a SolanaError whose message says nothing useful',
      Object.assign(new Error('erreur JSON-RPC'), {
        name: 'SolanaError',
        context: { __code: -32601 },
      }),
    ],
    [
      // Captured live from the Helius endpoint on 2026-08-20. A plan
      // restriction is a permanent capability answer, not an outage:
      // classifying it as unreachable tells the integrator to retry, which
      // can never succeed, instead of to change configuration.
      'a plan-restriction HTTP 403',
      Object.assign(new Error('HTTP error (403): Forbidden'), {
        name: 'SolanaError',
        context: { __code: 8_100_002, statusCode: 403, headers: {} },
      }),
    ],
    [
      // Same reasoning for a missing or wrong credential.
      'an unauthorized HTTP 401',
      Object.assign(new Error('HTTP error (401): Unauthorized'), {
        name: 'SolanaError',
        context: { __code: 8_100_002, statusCode: 401, headers: {} },
      }),
    ],
  ])('reports unsupported from %s', async (_label, error) => {
    getBundleStatuses.mockRejectedValue(error)

    await expect(probeJitoRpc('https://standard.example')).resolves.toBe(
      'unsupported'
    )
  })

  it.each([
    ['a throttle', new Error('429 Too Many Requests')],
    ['a timeout', new Error('fetch failed')],
    ['a gateway error', Object.assign(new Error('bad gateway'), { code: 502 })],
    [
      // Same `__code: 8100002` as the 403 above, so only the status tells
      // them apart. These genuinely do clear on a retry and must not be
      // reported to the integrator as a configuration problem.
      'a throttling HTTP 429',
      Object.assign(new Error('HTTP error (429): Too Many Requests'), {
        name: 'SolanaError',
        context: { __code: 8_100_002, statusCode: 429, headers: {} },
      }),
    ],
    [
      'a gateway HTTP 502',
      Object.assign(new Error('HTTP error (502): Bad Gateway'), {
        name: 'SolanaError',
        context: { __code: 8_100_002, statusCode: 502, headers: {} },
      }),
    ],
  ])('reports unreachable from %s', async (_label, error) => {
    // The bias is deliberate: an unrecognized failure must not be read as
    // "this endpoint does not do Jito", because that accuses the integrator of
    // a misconfiguration when the endpoint is merely having a bad minute.
    getBundleStatuses.mockRejectedValue(error)

    await expect(probeJitoRpc('https://jito.example')).resolves.toBe(
      'unreachable'
    )
  })
})

describe('getJitoRpcs', () => {
  const clientWith = (rpcUrls: string[]) =>
    ({ getRpcUrlsByChainId: vi.fn().mockResolvedValue(rpcUrls) }) as never

  beforeEach(() => {
    // The registry caches in module-level maps, so every test needs its own
    // module instance.
    vi.resetModules()
    getBundleStatuses.mockReset()
    createJitoRpc.mockClear()
  })

  it('probes an unsupported endpoint once, not once per submission', async () => {
    const { getJitoRpcs } = await import('./registry.js')
    getBundleStatuses.mockRejectedValue(new Error('Method not found'))
    const client = clientWith(['https://standard.example'])

    await getJitoRpcs(client)
    await getJitoRpcs(client)

    // A capability gap does not heal. Re-probing it costs up to
    // PROBE_TIMEOUT_MS per bundle submission, before submission can start.
    expect(getBundleStatuses).toHaveBeenCalledTimes(1)
  })

  it('re-probes an unreachable endpoint once the retry window closes', async () => {
    vi.useFakeTimers()
    try {
      const { getJitoRpcs, JITO_PROBE_RETRY_MS } = await import('./registry.js')
      getBundleStatuses.mockRejectedValue(new Error('429 Too Many Requests'))
      const client = clientWith(['https://jito.example'])

      await getJitoRpcs(client)
      await getJitoRpcs(client)
      expect(getBundleStatuses).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + JITO_PROBE_RETRY_MS)
      await getJitoRpcs(client)
      // An outage clears. A permanently cached `unreachable` would keep a
      // recovered endpoint out of the Jito list for the whole process.
      expect(getBundleStatuses).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps counting a cached unreachable endpoint as unreachable', async () => {
    const { getJitoRpcs } = await import('./registry.js')
    getBundleStatuses.mockRejectedValue(new Error('fetch failed'))
    const client = clientWith(['https://jito.example'])

    await getJitoRpcs(client)

    // The second call probes nothing, but the count still drives the two
    // different errors `sendAndConfirmBundle` raises: an outage to retry, or a
    // configuration gap to fix.
    await expect(getJitoRpcs(client)).resolves.toMatchObject({
      rpcs: [],
      unreachable: 1,
    })
  })

  it('still reports a cached unreachable endpoint beside a cached unsupported one', async () => {
    // The mixed case is what chooses the error `sendAndConfirmBundle` raises:
    // `unreachable > 0` means "retry, likely temporary", zero means "supply a
    // Jito-capable URL". Counting only the freshly probed endpoints would lose
    // the outage as soon as it was cached, and blame the integrator's config.
    const { getJitoRpcs } = await import('./registry.js')
    getBundleStatuses
      .mockRejectedValueOnce(new Error('Method not found'))
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
    const client = clientWith([
      'https://standard.example',
      'https://jito.example',
    ])

    await expect(getJitoRpcs(client)).resolves.toMatchObject({
      rpcs: [],
      unreachable: 1,
    })
    await expect(getJitoRpcs(client)).resolves.toMatchObject({
      rpcs: [],
      unreachable: 1,
    })
    // Neither endpoint was probed a second time.
    expect(getBundleStatuses).toHaveBeenCalledTimes(2)
  })

  it('caches a supported endpoint and reuses its client', async () => {
    const { getJitoRpcs } = await import('./registry.js')
    getBundleStatuses.mockResolvedValue({ value: [null] })
    const client = clientWith(['https://jito.example'])

    const first = await getJitoRpcs(client)
    const second = await getJitoRpcs(client)

    expect(first.rpcs).toHaveLength(1)
    // The very same client, not an equal one: a re-probe would build a second.
    expect(second.rpcs[0]).toBe(first.rpcs[0])
    expect(getBundleStatuses).toHaveBeenCalledTimes(1)
  })
})
