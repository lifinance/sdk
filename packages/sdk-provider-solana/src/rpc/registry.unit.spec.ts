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

const { isJitoRpc, probeJitoRpc } = await import('./registry.js')

describe('isJitoRpc', () => {
  beforeEach(() => {
    getBundleStatuses.mockReset()
  })

  it('returns true when getBundleStatuses resolves (Jito-capable RPC)', async () => {
    getBundleStatuses.mockResolvedValue({ value: [null] })

    await expect(isJitoRpc('https://jito-capable.example')).resolves.toBe(true)

    // Probe must execute getBundleStatuses with a single well-formed bundle id,
    // never an empty array (which a Jito RPC could reject as invalid). The id is
    // valid as both hex and base-58 so providers don't reject it on format.
    const probeArg = getBundleStatuses.mock.calls[0][0] as string[]
    expect(Array.isArray(probeArg)).toBe(true)
    expect(probeArg).toHaveLength(1)
    expect(probeArg[0]).toHaveLength(64)
    expect(probeArg[0]).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/) // base-58 alphabet
  })

  it('returns false when getBundleStatuses throws "Method not found" (standard RPC)', async () => {
    getBundleStatuses.mockRejectedValue(new Error('Method not found'))

    await expect(isJitoRpc('https://standard-solana.example')).resolves.toBe(
      false
    )
  })
})

describe('probeJitoRpc', () => {
  beforeEach(() => {
    getBundleStatuses.mockReset()
  })

  it('reports supported when the endpoint answers', async () => {
    getBundleStatuses.mockResolvedValue({ value: [null] })

    await expect(probeJitoRpc('https://jito.example')).resolves.toBe(
      'supported'
    )
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

    await expect(probeJitoRpc('https://standard.example')).resolves.toBe(
      'unsupported'
    )
  })

  it.each([
    ['a throttle', new Error('429 Too Many Requests')],
    ['a timeout', new Error('fetch failed')],
    ['a gateway error', Object.assign(new Error('bad gateway'), { code: 502 })],
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
