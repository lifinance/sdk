import type { Signature } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SolanaRpcType } from '../rpc/types.js'
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

const { confirmSignature } = await import('./confirmSignature.js')
const { MAX_PROBE_ERRORS } = await import('./createConfirmationDeadline.js')

const getSignatureStatuses = vi.fn()

const rpc = {
  getSignatureStatuses: (...args: unknown[]) => ({
    send: () => getSignatureStatuses(...args),
  }),
} as unknown as SolanaRpcType

const SIGNATURE = 'sig' as Signature
const LIFETIMES: TransactionLifetime[] = [{ kind: 'unknown' }]

const status = (confirmationStatus: string) => ({
  value: [{ confirmationStatus, err: null }],
})
const noStatus = () => ({ value: [null] })

type Resend = (rpc: SolanaRpcType, signal: AbortSignal) => Promise<void>

const run = (resend: Resend = vi.fn(() => Promise.resolve())) =>
  confirmSignature({
    rpc,
    signal: new AbortController().signal,
    signature: SIGNATURE,
    lifetimes: LIFETIMES,
    resend,
  })

describe('confirmSignature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reached.mockReturnValue(false)
    tick.mockResolvedValue(undefined)
  })

  it('confirms on a later poll, not only the first', async () => {
    reached.mockReturnValueOnce(false).mockReturnValueOnce(false)
    getSignatureStatuses
      .mockResolvedValueOnce(noStatus())
      .mockResolvedValueOnce(noStatus())
      .mockResolvedValueOnce(status('confirmed'))
    const resend = vi.fn<Resend>(() => Promise.resolve())

    await expect(run(resend)).resolves.toEqual({
      kind: 'confirmed',
      value: { confirmationStatus: 'confirmed', err: null },
    })
    expect(getSignatureStatuses).toHaveBeenCalledTimes(3)
    // The detached resend loop kept sending after the awaited first send, and
    // it passes its own branch signal rather than the caller's.
    expect(resend.mock.calls.length).toBeGreaterThan(1)
    expect(resend.mock.calls[1][1]).not.toBe(resend.mock.calls[0][1])
  })

  it('treats "finalized" as confirmed', async () => {
    getSignatureStatuses.mockResolvedValue(status('finalized'))

    const result = await run()

    expect(result.kind).toBe('confirmed')
  })

  it('ignores a "processed" status and keeps polling', async () => {
    reached.mockReturnValueOnce(false)
    getSignatureStatuses
      .mockResolvedValueOnce(status('processed'))
      .mockResolvedValueOnce(status('confirmed'))

    const result = await run()

    expect(result.kind).toBe('confirmed')
    // The discriminating assertion: a 'processed' status must NOT confirm, so
    // the second poll is what confirms. One call would mean 'processed' was
    // accepted.
    expect(getSignatureStatuses).toHaveBeenCalledTimes(2)
  })

  it('confirms in the final probe after the deadline is reached', async () => {
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue(status('confirmed'))

    const result = await run()

    expect(result.kind).toBe('confirmed')
    // Loop body never ran; only the final probe did.
    expect(getSignatureStatuses).toHaveBeenCalledTimes(1)
  })

  it('returns not-confirmed when the deadline passes with no confirmation', async () => {
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue(noStatus())

    await expect(run()).resolves.toEqual({ kind: 'not-confirmed' })
  })

  it('tolerates a transient probe failure and still confirms', async () => {
    reached.mockReturnValueOnce(false).mockReturnValueOnce(false)
    getSignatureStatuses
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce(status('confirmed'))

    const result = await run()

    expect(result.kind).toBe('confirmed')
  })

  it('throws after MAX_PROBE_ERRORS consecutive probe failures', async () => {
    getSignatureStatuses.mockRejectedValue(new Error('method not found'))

    await expect(run()).rejects.toThrow('method not found')
    expect(getSignatureStatuses).toHaveBeenCalledTimes(MAX_PROBE_ERRORS)
  })

  it('throws instead of returning not-confirmed when every send failed', async () => {
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue(noStatus())
    const resend = vi.fn(() => Promise.reject(new Error('connection refused')))

    await expect(run(resend)).rejects.toThrow(/send attempt/i)
  })

  it('returns not-confirmed when sends succeeded but nothing landed', async () => {
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue(noStatus())
    const resend = vi.fn(() => Promise.resolve())

    await expect(run(resend)).resolves.toEqual({ kind: 'not-confirmed' })
  })
})
