import { beforeEach, describe, expect, it, vi } from 'vitest'

const getBundleStatuses = vi.fn()
const createJitoRpc = vi.fn(() => ({
  getBundleStatuses: (...args: unknown[]) => ({
    send: () => getBundleStatuses(...args),
  }),
}))

vi.mock('./jito/createJitoRpc.js', () => ({
  createJitoRpc: (...args: unknown[]) => createJitoRpc(...args),
}))

const { isJitoRpc } = await import('./registry.js')

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
