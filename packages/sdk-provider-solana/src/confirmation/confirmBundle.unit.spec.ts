import type { Signature } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JitoRpcType } from '../rpc/types.js'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'

vi.mock('@lifi/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lifi/sdk')>()),
  sleep: () => Promise.resolve(),
}))

const reached = vi.fn<() => boolean>()
const tick = vi.fn<() => Promise<void>>(() => Promise.resolve())

vi.mock('./createConfirmationDeadline.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./createConfirmationDeadline.js')>()),
  createConfirmationDeadline: () => ({
    reached: () => reached(),
    tick: () => tick(),
  }),
}))

const { confirmBundle } = await import('./confirmBundle.js')
const { MAX_PROBE_ERRORS } = await import('./createConfirmationDeadline.js')

const getBundleStatuses = vi.fn()
const getSignatureStatuses = vi.fn()

const rpc = {
  getBundleStatuses: (...args: unknown[]) => ({
    send: () => getBundleStatuses(...args),
  }),
  getSignatureStatuses: (...args: unknown[]) => ({
    send: () => getSignatureStatuses(...args),
  }),
} as unknown as JitoRpcType

const TX_SIGNATURES = ['sigA', 'sigB'] as Signature[]
const LIFETIMES: TransactionLifetime[] = [{ kind: 'unknown' }]

const bundle = (confirmation_status: string | null) => ({
  value: [{ confirmation_status, transactions: TX_SIGNATURES }],
})
const noBundle = () => ({ value: [null] })

const run = () =>
  confirmBundle({
    rpc,
    signal: new AbortController().signal,
    bundleId: 'bundle-1',
    lifetimes: LIFETIMES,
  })

describe('confirmBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reached.mockReturnValue(false)
    tick.mockResolvedValue(undefined)
  })

  it('confirms on a later poll, not only the first', async () => {
    getBundleStatuses
      .mockResolvedValueOnce(noBundle())
      .mockResolvedValueOnce(bundle('processed'))
      .mockResolvedValueOnce(bundle('confirmed'))
    getSignatureStatuses.mockResolvedValue({ value: [null, null] })

    const result = await run()

    expect(result).toEqual({
      kind: 'confirmed',
      value: {
        bundleId: 'bundle-1',
        txSignatures: TX_SIGNATURES,
        signatureResults: [null, null],
      },
    })
    expect(getBundleStatuses).toHaveBeenCalledTimes(3)
    // Three polls means two completed iterations, so the deadline advanced
    // twice. A `continue` that skipped `deadline.tick` would make this zero.
    expect(tick).toHaveBeenCalledTimes(2)
  })

  it('keeps polling when the bundle is confirmed but signature results are missing', async () => {
    getBundleStatuses.mockResolvedValue(bundle('confirmed'))
    getSignatureStatuses
      .mockResolvedValueOnce({ value: null })
      .mockResolvedValueOnce({ value: [null, null] })

    const result = await run()

    expect(result.kind).toBe('confirmed')
    expect(getSignatureStatuses).toHaveBeenCalledTimes(2)
  })

  it('treats missing signature results identically in the final probe', async () => {
    reached.mockReturnValue(true)
    getBundleStatuses.mockResolvedValue(bundle('confirmed'))
    getSignatureStatuses.mockResolvedValue({ value: null })

    await expect(run()).resolves.toEqual({ kind: 'not-confirmed' })
  })

  it('confirms in the final probe after the deadline is reached', async () => {
    reached.mockReturnValue(true)
    getBundleStatuses.mockResolvedValue(bundle('finalized'))
    getSignatureStatuses.mockResolvedValue({ value: [null, null] })

    const result = await run()

    expect(result.kind).toBe('confirmed')
    expect(getBundleStatuses).toHaveBeenCalledTimes(1)
  })

  it('returns not-confirmed when the deadline passes with no confirmation', async () => {
    reached.mockReturnValue(true)
    getBundleStatuses.mockResolvedValue(noBundle())

    await expect(run()).resolves.toEqual({ kind: 'not-confirmed' })
  })

  it('resets the probe-failure streak after a successful poll', async () => {
    // MAX_PROBE_ERRORS failures, none of them consecutive. Only a streak that
    // resets on every success stays below the throw threshold.
    for (let i = 0; i < MAX_PROBE_ERRORS; i += 1) {
      getBundleStatuses
        .mockRejectedValueOnce(new Error('502'))
        .mockResolvedValueOnce(noBundle())
    }
    getBundleStatuses.mockResolvedValueOnce(bundle('confirmed'))
    getSignatureStatuses.mockResolvedValue({ value: [null, null] })

    const result = await run()

    expect(result.kind).toBe('confirmed')
    expect(getBundleStatuses).toHaveBeenCalledTimes(MAX_PROBE_ERRORS * 2 + 1)
  })

  it('throws after MAX_PROBE_ERRORS consecutive probe failures', async () => {
    getBundleStatuses.mockRejectedValue(new Error('method not found'))

    await expect(run()).rejects.toThrow('method not found')
    expect(getBundleStatuses).toHaveBeenCalledTimes(MAX_PROBE_ERRORS)
  })
})
