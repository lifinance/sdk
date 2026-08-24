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

    await expect(probeJitoRpc('https://jito.example')).resolves.toMatchObject({
      outcome: 'supported',
    })

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
  ])('reports unsupported from %s', async (_label, error) => {
    getBundleStatuses.mockRejectedValue(error)

    await expect(
      probeJitoRpc('https://standard.example')
    ).resolves.toMatchObject({
      outcome: 'unsupported',
    })
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
      // Captured live from the Helius endpoint on 2026-08-20. A bare HTTP
      // status never reached the JSON-RPC layer, so it is a gateway verdict,
      // not a capability answer: a plan gate looks exactly like a provider
      // deploy or an allowlist entry still propagating. Classified as
      // unreachable so it can heal - `unsupported` never expires, and one
      // transient 403 used to remove the endpoint for the process lifetime.
      'a plan-restriction HTTP 403',
      Object.assign(new Error('HTTP error (403): Forbidden'), {
        name: 'SolanaError',
        context: { __code: 8_100_002, statusCode: 403, headers: {} },
      }),
    ],
    [
      // Same reasoning. A credential usually heals faster than a plan gate,
      // but both share one window today - splitting them would buy a shorter
      // outage only for the 401 case.
      'an unauthorized HTTP 401',
      Object.assign(new Error('HTTP error (401): Unauthorized'), {
        name: 'SolanaError',
        context: { __code: 8_100_002, statusCode: 401, headers: {} },
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

    await expect(probeJitoRpc('https://jito.example')).resolves.toMatchObject({
      outcome: 'unreachable',
    })
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

  it('re-probes a gateway-refused endpoint, but only after a longer window', async () => {
    vi.useFakeTimers()
    try {
      const { getJitoRpcs, JITO_PROBE_RETRY_MS, JITO_PROBE_GATEWAY_RETRY_MS } =
        await import('./registry.js')
      // A bare 401/403 proves nothing about capability, so it must expire.
      // But a real plan gate answers the same way, and re-probing that on the
      // 30 s outage cadence is waste on the pre-submission latency path.
      expect(JITO_PROBE_GATEWAY_RETRY_MS).toBeGreaterThan(JITO_PROBE_RETRY_MS)

      getBundleStatuses.mockRejectedValue(
        Object.assign(new Error('HTTP error (403): Forbidden'), {
          name: 'SolanaError',
          context: { __code: 8_100_002, statusCode: 403, headers: {} },
        })
      )
      const client = clientWith(['https://gated.example'])

      await getJitoRpcs(client)
      expect(getBundleStatuses).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + JITO_PROBE_RETRY_MS)
      await getJitoRpcs(client)
      expect(getBundleStatuses).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + JITO_PROBE_GATEWAY_RETRY_MS)
      await getJitoRpcs(client)
      expect(getBundleStatuses).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never re-probes an endpoint that named the method unknown', async () => {
    vi.useFakeTimers()
    try {
      const { getJitoRpcs, JITO_PROBE_GATEWAY_RETRY_MS } = await import(
        './registry.js'
      )
      // `-32601` reached the JSON-RPC layer, so the server parsed the request
      // and said it has no such method. That is a definitive answer and never
      // heals; only the gateway verdicts above get a retry window.
      getBundleStatuses.mockRejectedValue(
        Object.assign(new Error('erreur JSON-RPC'), {
          name: 'SolanaError',
          context: { __code: -32601 },
        })
      )
      const client = clientWith(['https://standard.example'])

      await getJitoRpcs(client)
      vi.setSystemTime(Date.now() + JITO_PROBE_GATEWAY_RETRY_MS * 10)
      await getJitoRpcs(client)

      expect(getBundleStatuses).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fires one probe per URL when two submissions race', async () => {
    // Without an in-flight guard both callers compute the same `unprobed` list
    // from the same stale cache and both probe every URL, at up to
    // PROBE_TIMEOUT_MS each, on the latency path before submission can start.
    // The slower probe then writes last: a 5 s timeout resolving `unreachable`
    // overwrote a `supported` answer that landed at 300 ms and evicted a
    // verified-healthy endpoint.
    const { getJitoRpcs } = await import('./registry.js')
    const resolvers: ((value: unknown) => void)[] = []
    getBundleStatuses.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        })
    )
    const client = clientWith(['https://jito.example'])

    const first = getJitoRpcs(client)
    const second = getJitoRpcs(client)
    await vi.waitFor(() => expect(resolvers.length).toBeGreaterThan(0))
    for (const resolve of resolvers) {
      resolve({ value: [null] })
    }
    await Promise.all([first, second])

    expect(getBundleStatuses).toHaveBeenCalledTimes(1)
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
