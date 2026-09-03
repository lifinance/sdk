import { BASE_FEE } from '@stellar/stellar-sdk'
import type { Server } from '@stellar/stellar-sdk/rpc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveSorobanInclusionFee } from './resolveInclusionFee.js'

const FALLBACK_FEE = '10000'
const MAX_FEE_STROOPS = '1000000'

/** A server whose `getFeeStats` resolves to the given soroban distribution. */
const serverWith = (sorobanInclusionFee: unknown): Server =>
  ({
    getFeeStats: vi.fn().mockResolvedValue({ sorobanInclusionFee }),
  }) as unknown as Server

const failingServer = (): Server =>
  ({
    getFeeStats: vi.fn().mockRejectedValue(new Error('rpc down')),
  }) as unknown as Server

describe('resolveSorobanInclusionFee', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('bids the p70 percentile of the soroban distribution', async () => {
    const server = serverWith({ p50: '150', p70: '200', p95: '400' })

    await expect(resolveSorobanInclusionFee(server)).resolves.toBe('200')
  })

  it('bids above the network minimum when the market is above it', async () => {
    const server = serverWith({ p70: '200' })

    const fee = await resolveSorobanInclusionFee(server)

    // the whole point: BASE_FEE is a floor, not a price. A bid equal to the
    // minimum on a busy ledger expires unincluded.
    expect(Number(fee)).toBeGreaterThan(Number(BASE_FEE))
  })

  it('floors a below-minimum percentile at the network minimum', async () => {
    const server = serverWith({ p70: '1' })

    await expect(resolveSorobanInclusionFee(server)).resolves.toBe(BASE_FEE)
  })

  it('caps an absurd percentile so a broken RPC cannot drain the fee', async () => {
    const server = serverWith({ p70: '999999999' })

    await expect(resolveSorobanInclusionFee(server)).resolves.toBe(
      MAX_FEE_STROOPS
    )
  })

  it('drops a fractional part, which the transaction builder rejects', async () => {
    // TransactionBuilder throws 'Transaction.fee: expected integer in range
    // 0..4294967295', and the throw sits inside the RPC failover callback — so
    // a fractional percentile would look like an outage of every RPC.
    const server = serverWith({ p70: '150.5' })

    await expect(resolveSorobanInclusionFee(server)).resolves.toBe('150')
  })

  it('falls back when the percentile is missing', async () => {
    const server = serverWith({ p50: '200' })

    await expect(resolveSorobanInclusionFee(server)).resolves.toBe(FALLBACK_FEE)
  })

  it('falls back when the distribution is absent entirely', async () => {
    const server = serverWith(undefined)

    await expect(resolveSorobanInclusionFee(server)).resolves.toBe(FALLBACK_FEE)
  })

  it('falls back when the percentile is not a number', async () => {
    const server = serverWith({ p70: 'not-a-fee' })

    await expect(resolveSorobanInclusionFee(server)).resolves.toBe(FALLBACK_FEE)
  })

  it('falls back rather than failing when getFeeStats rejects', async () => {
    // the surrounding RPC failover has already proven the server answers, so a
    // fee-stats hiccup must not block the approval
    await expect(resolveSorobanInclusionFee(failingServer())).resolves.toBe(
      FALLBACK_FEE
    )
  })

  it('warns on every degraded path so the fallback is never silent', async () => {
    await resolveSorobanInclusionFee(serverWith({ p50: '200' }))
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unusable fee percentile'),
      10_000,
      undefined
    )

    await resolveSorobanInclusionFee(failingServer())
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Fee stats unreadable'),
      10_000,
      expect.any(Error)
    )
  })
})
