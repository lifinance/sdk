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
/** Options every `createConfirmationDeadline` call received, in order. */
const deadlineCalls: unknown[] = []

vi.mock('./createConfirmationDeadline.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./createConfirmationDeadline.js')>()),
  createConfirmationDeadline: (options: unknown) => {
    deadlineCalls.push(options)
    return {
      reached: () => reached(),
      tick: () => tick(),
    }
  },
}))

const { confirmSignature } = await import('./confirmSignature.js')
const { MAX_PROBE_ERRORS } = await import('./createConfirmationDeadline.js')

const getSignatureStatuses = vi.fn()
/** Options every `getSignatureStatuses(...).send(...)` call received. */
const statusSendOptions: unknown[] = []

const rpc = {
  getSignatureStatuses: (...args: unknown[]) => ({
    send: (options: unknown) => {
      statusSendOptions.push(options)
      return getSignatureStatuses(...args)
    },
  }),
} as unknown as SolanaRpcType

const SIGNATURE = 'sig' as Signature
const LIFETIMES: TransactionLifetime[] = [{ kind: 'unknown' }]

const status = (confirmationStatus: string) => ({
  value: [{ confirmationStatus, err: null }],
})
const noStatus = () => ({ value: [null] })

type Resend = (rpc: SolanaRpcType, signal: AbortSignal) => Promise<void>

const run = (
  resend: Resend = vi.fn(() => Promise.resolve()),
  signal: AbortSignal = new AbortController().signal
) =>
  confirmSignature({
    rpc,
    signal,
    signature: SIGNATURE,
    lifetimes: LIFETIMES,
    resend,
  })

describe('confirmSignature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deadlineCalls.length = 0
    statusSendOptions.length = 0
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

  it('hands the caller signal to every status read', async () => {
    // The abort signal is the only way `raceRpcs` and `BRANCH_TIMEOUT_MS` can
    // end a read that hangs. A read sent without it never rejects, the race
    // never settles, and the task hangs forever - so the *caller's* signal
    // must reach the transport on every read, by identity, not a look-alike
    // (the resend loop's branch signal is exactly such a look-alike).
    const controller = new AbortController()
    reached.mockReturnValueOnce(false)
    getSignatureStatuses
      .mockResolvedValueOnce(noStatus())
      .mockResolvedValueOnce(status('confirmed'))

    const result = await run(undefined, controller.signal)

    expect(result.kind).toBe('confirmed')
    expect(statusSendOptions).toHaveLength(2)
    for (const options of statusSendOptions) {
      expect(options).toEqual({ abortSignal: controller.signal })
    }
  })

  it('builds the deadline from the caller lifetimes and rpc', async () => {
    // The deadline factory owns the whole blockhash-expiry policy. Handing it
    // an empty lifetime set silently disables that policy and degrades every
    // confirmation to the 90 s ceiling, so the hand-off itself is pinned.
    getSignatureStatuses.mockResolvedValue(status('confirmed'))

    await run()

    expect(deadlineCalls).toEqual([{ lifetimes: LIFETIMES, rpc }])
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

  it('resets the probe-failure streak after a successful poll', async () => {
    // MAX_PROBE_ERRORS failures, none of them consecutive. Only a streak that
    // resets on every success stays below the throw threshold.
    for (let i = 0; i < MAX_PROBE_ERRORS; i += 1) {
      getSignatureStatuses
        .mockRejectedValueOnce(new Error('502'))
        .mockResolvedValueOnce(noStatus())
    }
    getSignatureStatuses.mockResolvedValueOnce(status('confirmed'))

    const result = await run()

    expect(result.kind).toBe('confirmed')
    expect(getSignatureStatuses).toHaveBeenCalledTimes(MAX_PROBE_ERRORS * 2 + 1)
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

  it('throws instead of returning not-confirmed when every status read hung', async () => {
    // A hung endpoint: the read is still in flight when the branch timeout
    // aborts it. That is one failure, so MAX_PROBE_ERRORS never fires; the
    // loop then exits on the aborted signal and the final probe is skipped.
    // Reporting `not-confirmed` here would turn a hung RPC into
    // `TransactionExpired`, the exact misdiagnosis this rework removes.
    const controller = new AbortController()
    reached.mockReturnValue(false)
    getSignatureStatuses.mockImplementation(() => {
      controller.abort()
      return Promise.reject(new Error('request aborted'))
    })
    const resend = vi.fn(() => Promise.resolve())

    await expect(run(resend, controller.signal)).rejects.toThrow(
      /never observed here/i
    )
    // Exactly one read, so the throw cannot be the MAX_PROBE_ERRORS rule; and
    // the send succeeded, so it cannot be the send rule either.
    expect(getSignatureStatuses).toHaveBeenCalledTimes(1)
    expect(resend).toHaveBeenCalled()
  })

  it('throws instead of returning not-confirmed when the endpoint answers once and then hangs', async () => {
    // One good read, then a read that stays in flight until the branch is
    // aborted. A flag that latches on the first answer would report
    // `not-confirmed` on one second of actual observation; the branch must
    // instead refuse the verdict, because it never observed the endpoint near
    // the deadline and `not-confirmed` outranks every error in `raceRpcs`.
    const controller = new AbortController()
    reached.mockReturnValue(false)
    getSignatureStatuses
      .mockResolvedValueOnce(noStatus())
      .mockImplementationOnce(() => {
        controller.abort()
        return Promise.reject(new Error('request aborted'))
      })
    const resend = vi.fn(() => Promise.resolve())

    await expect(run(resend, controller.signal)).rejects.toThrow(
      /not observed near the deadline/i
    )
    // Two reads: the first answered, so the never-observed rule cannot be the
    // thrower, and the second is one failure, so MAX_PROBE_ERRORS cannot be
    // either. The send succeeded, ruling out the send rule too.
    expect(getSignatureStatuses).toHaveBeenCalledTimes(2)
  })
})
