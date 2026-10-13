import type { Signature } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SolanaRpcType } from '../rpc/types.js'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'

/** Every `sleep` duration requested, poll loop and deadline loop together. */
const sleepCalls: number[] = []

vi.mock('./abortableSleep.js', () => ({
  // Macrotask, not microtask - see pollUntilDeadline.unit.spec.ts.
  abortableSleep: (ms: number) => {
    sleepCalls.push(ms)
    return new Promise<void>((resolve) => setTimeout(resolve, 0))
  },
}))

const reached = vi.fn<() => boolean>()
const expiredAt = vi.fn<() => bigint | undefined>(() => undefined)
const tick = vi.fn<() => Promise<void>>(() => Promise.resolve())
/** Records what happened in which order, for the deadline-before-send test. */
const events: string[] = []

/** Options every `createConfirmationDeadline` call received, in order. */
const deadlineCalls: unknown[] = []

vi.mock('./createConfirmationDeadline.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./createConfirmationDeadline.js')>()),
  createConfirmationDeadline: (options: unknown) => {
    events.push('deadline')
    deadlineCalls.push(options)
    return {
      reached: () => reached(),
      expiredAt: () => expiredAt(),
      tick: () => tick(),
    }
  },
}))

const { BUNDLE_POLL_INTERVAL_MS, confirmBundle } = await import(
  './confirmBundle.js'
)
const { DEADLINE_TICK_INTERVAL_MS, STATUS_RETRY_BACKOFF_CAP_MS } = await import(
  './pollUntilDeadline.js'
)

const getSignatureStatuses = vi.fn()

/** Options every `getSignatureStatuses(...).send(...)` call received. */
const signatureSendOptions: unknown[] = []

const rpc = {
  getSignatureStatuses: (...args: unknown[]) => ({
    send: (options: unknown) => {
      signatureSendOptions.push(options)
      return getSignatureStatuses(...args)
    },
  }),
} as unknown as SolanaRpcType

const TX_SIGNATURES = ['sigA', 'sigB'] as Signature[]
const LIFETIMES: TransactionLifetime[] = [{ kind: 'unknown' }]

const bundle = (confirmationStatus: string | null) => ({
  value: TX_SIGNATURES.map(() => ({ confirmationStatus, err: null })),
})
const noBundle = () => ({ value: [null, null] })

const send = vi.fn(() => {
  events.push('send')
  return Promise.resolve('bundle-1')
})

const run = (signal: AbortSignal = new AbortController().signal) =>
  confirmBundle({
    rpc,
    signal,
    signatures: TX_SIGNATURES,
    lifetimes: LIFETIMES,
    send,
  })

describe('confirmBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    deadlineCalls.length = 0
    signatureSendOptions.length = 0
    sleepCalls.length = 0
    reached.mockReturnValue(false)
    expiredAt.mockReturnValue(undefined)
    tick.mockResolvedValue(undefined)
  })

  it('confirms on a later poll, not only the first', async () => {
    getSignatureStatuses
      .mockResolvedValueOnce(noBundle())
      .mockResolvedValueOnce(bundle('processed'))
      .mockResolvedValueOnce(bundle('confirmed'))

    const result = await run()

    expect(result).toEqual({
      kind: 'confirmed',
      value: { signatureResults: bundle('confirmed').value },
    })
    expect(getSignatureStatuses).toHaveBeenCalledTimes(3)
    // The deadline now advances on its own detached cadence (pinned in
    // pollUntilDeadline.unit.spec.ts), so no per-iteration tick count is
    // asserted here.
  })

  it('polls signature statuses no faster than the bundle interval', async () => {
    getSignatureStatuses
      .mockResolvedValueOnce(noBundle())
      .mockResolvedValueOnce(bundle('confirmed'))

    const result = await run()

    expect(result.kind).toBe('confirmed')
    const pollSleeps = sleepCalls.filter(
      (ms) => ms !== DEADLINE_TICK_INTERVAL_MS
    )
    expect(pollSleeps.length).toBeGreaterThan(0)
    for (const ms of pollSleeps) {
      expect(ms).toBeGreaterThanOrEqual(BUNDLE_POLL_INTERVAL_MS)
    }
  })

  it('leaves head-room above the bundle interval for a real backoff', () => {
    // `pollUntilDeadline` clamps every retry with
    // `Math.max(pollIntervalMs, Math.min(pollIntervalMs * 2 ** failures, cap))`.
    // With the cap equal to this interval, that `max` returned the base
    // interval for every failure count, so the bundle path never backed off at
    // all while the comment claimed a falling rate.
    expect(STATUS_RETRY_BACKOFF_CAP_MS).toBeGreaterThan(BUNDLE_POLL_INTERVAL_MS)
  })

  it('slows down after a failed status read', async () => {
    getSignatureStatuses
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce(bundle('confirmed'))

    const result = await run()

    expect(result.kind).toBe('confirmed')
    const pollSleeps = sleepCalls.filter(
      (ms) => ms !== DEADLINE_TICK_INTERVAL_MS
    )
    expect(pollSleeps[0]).toBeGreaterThan(BUNDLE_POLL_INTERVAL_MS)
  })

  it('hands the caller signal to every status read', async () => {
    // The abort signal is the only way `raceRpcs` and `BRANCH_TIMEOUT_MS` can
    // end a read that hangs. A read sent without it never rejects, the race
    // never settles, and the task hangs forever - so the *caller's* signal
    // must reach the transport on every read, by identity.
    const controller = new AbortController()
    reached.mockReturnValueOnce(false)
    getSignatureStatuses
      .mockResolvedValueOnce(noBundle())
      .mockResolvedValueOnce(bundle('confirmed'))

    const result = await run(controller.signal)

    expect(result.kind).toBe('confirmed')
    expect(signatureSendOptions).toHaveLength(2)
    for (const options of signatureSendOptions) {
      expect(options).toEqual({ abortSignal: controller.signal })
    }
  })

  it('reads every signature of the bundle in one request', async () => {
    getSignatureStatuses.mockResolvedValue(bundle('confirmed'))

    await run()

    expect(getSignatureStatuses).toHaveBeenCalledTimes(1)
    expect(getSignatureStatuses).toHaveBeenCalledWith(TX_SIGNATURES)
  })

  it('keeps polling while any signature of the bundle is unconfirmed', async () => {
    // One read sees a bundle whole: it lands in one slot. A partial or short
    // answer says nothing yet.
    getSignatureStatuses
      .mockResolvedValueOnce({
        value: [{ confirmationStatus: 'confirmed' }, null],
      })
      .mockResolvedValueOnce({ value: [{ confirmationStatus: 'confirmed' }] })
      .mockResolvedValueOnce(bundle('confirmed'))

    const result = await run()

    expect(result.kind).toBe('confirmed')
    expect(getSignatureStatuses).toHaveBeenCalledTimes(3)
  })

  it('confirms by the signatures whatever sendBundle answered', async () => {
    // JUM-1669: a sender answered with signatures, not a bundle id. The
    // answer differs from the bundle's signatures, so a read of it would show.
    send.mockResolvedValueOnce(['sigX', 'sigY'] as never)
    getSignatureStatuses.mockResolvedValue(bundle('confirmed'))

    await expect(run()).resolves.toMatchObject({ kind: 'confirmed' })
    expect(getSignatureStatuses).toHaveBeenCalledWith(TX_SIGNATURES)
  })

  it('builds the deadline from the caller lifetimes and rpc', async () => {
    // The deadline factory owns the whole blockhash-expiry policy. Handing it
    // an empty lifetime set silently disables that policy and degrades every
    // confirmation to the 90 s ceiling, so the hand-off itself is pinned.
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue(noBundle())

    await run()

    expect(deadlineCalls).toEqual([{ lifetimes: LIFETIMES, rpc }])
  })

  it('does not report a broadcast that fulfils after the branch was aborted', async () => {
    // The caller's once-guard latches only after the callback returns, so a
    // throwing hook leaves it open; a late fulfilment would then re-write a
    // finalized action back to PENDING.
    const controller = new AbortController()
    const onBroadcast = vi.fn()
    getSignatureStatuses.mockResolvedValue(bundle('confirmed'))
    controller.abort()

    await confirmBundle({
      rpc,
      signal: controller.signal,
      signatures: TX_SIGNATURES,
      lifetimes: LIFETIMES,
      send,
      onBroadcast,
    }).catch(() => undefined)

    expect(onBroadcast).not.toHaveBeenCalled()
  })

  it('confirms in the final probe after the deadline is reached', async () => {
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue(bundle('finalized'))

    const result = await run()

    expect(result.kind).toBe('confirmed')
    expect(getSignatureStatuses).toHaveBeenCalledTimes(1)
  })

  it('returns not-confirmed when the deadline passes with no confirmation', async () => {
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue(noBundle())

    await expect(run()).resolves.toEqual({ kind: 'not-confirmed' })
  })

  it('treats a { value: null } bundle payload as an answer, not a failed read', async () => {
    // An endpoint that responds `{ value: null }` said nothing, but it did
    // answer. Indexing into it unguarded throws a `TypeError` that burns a
    // read-failure slot - and in the final probe it voids the whole
    // observation, misreporting an answering endpoint as one that never
    // completed a read.
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue({ value: null })

    await expect(run()).resolves.toEqual({ kind: 'not-confirmed' })
  })

  it('treats a non-array payload with a length as an answer, not a failed read', async () => {
    // Unvalidated wire data: an object with a numeric `length` would pass a
    // bare length check and then throw out of `.every`.
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue({ value: { length: 2 } })

    await expect(run()).resolves.toEqual({ kind: 'not-confirmed' })
  })

  it('reports the broadcast once the submission is accepted', async () => {
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue(noBundle())
    const onBroadcast = vi.fn()

    await confirmBundle({
      rpc,
      signal: new AbortController().signal,
      signatures: TX_SIGNATURES,
      lifetimes: LIFETIMES,
      send,
      onBroadcast,
    })

    expect(onBroadcast).toHaveBeenCalledTimes(1)
  })

  it('does not report a broadcast when the submission fails', async () => {
    // The callback is the wait task's cue to publish an explorer link. A
    // rejected submission never put the bundle in the network's hands, so it
    // must not produce that cue.
    send.mockRejectedValueOnce(new Error('jito rejected the bundle'))
    const onBroadcast = vi.fn()

    await expect(
      confirmBundle({
        rpc,
        signal: new AbortController().signal,
        signatures: TX_SIGNATURES,
        lifetimes: LIFETIMES,
        send,
        onBroadcast,
      })
    ).rejects.toThrow('jito rejected the bundle')
    expect(onBroadcast).not.toHaveBeenCalled()
  })

  it('resets the probe-failure streak after a successful poll', async () => {
    // Twenty failures, none of them consecutive. Only a budget that resets on
    // every answer survives them.
    for (let i = 0; i < 20; i += 1) {
      getSignatureStatuses
        .mockRejectedValueOnce(new Error('502'))
        .mockResolvedValueOnce(noBundle())
    }
    getSignatureStatuses.mockResolvedValueOnce(bundle('confirmed'))

    const result = await run()

    expect(result.kind).toBe('confirmed')
    expect(getSignatureStatuses).toHaveBeenCalledTimes(41)
  })

  it('builds the deadline before it submits the bundle', async () => {
    // `BRANCH_TIMEOUT_MS` starts when the branch starts. A deadline built
    // after the submission returns would push the 90 s ceiling past the
    // branch's own timeout, and a slow `sendBundle` would eat the margin that
    // protects the final probe.
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue(noBundle())

    await run()

    expect(events).toEqual(['deadline', 'send'])
  })

  it('propagates a submission failure instead of reporting not-confirmed', async () => {
    send.mockRejectedValueOnce(new Error('jito rejected the bundle'))

    await expect(run()).rejects.toThrow('jito rejected the bundle')
    expect(getSignatureStatuses).not.toHaveBeenCalled()
  })

  it('throws instead of returning not-confirmed when every status read hung', async () => {
    // A hung endpoint: the read is still in flight when the branch timeout
    // aborts it. An in-flight read never answers, so it never renews the
    // silence budget and never throws either - the abort arrives first. The
    // loop then exits on the aborted signal and the final probe is skipped.
    const controller = new AbortController()
    reached.mockReturnValue(false)
    getSignatureStatuses.mockImplementation(() => {
      controller.abort()
      return Promise.reject(new Error('request aborted'))
    })

    await expect(run(controller.signal)).rejects.toThrow(/ever completed/i)
    // Exactly one read, so the throw cannot be the silence-budget rule.
    expect(getSignatureStatuses).toHaveBeenCalledTimes(1)
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
      .mockResolvedValueOnce(noBundle())
      .mockImplementationOnce(() => {
        controller.abort()
        return Promise.reject(new Error('request aborted'))
      })

    await expect(run(controller.signal)).rejects.toThrow(/stopped answering/i)
    // Two reads: the first answered, so the never-observed rule cannot be the
    // thrower, and the second never renewed the silence budget, so that rule
    // cannot be either.
    expect(getSignatureStatuses).toHaveBeenCalledTimes(2)
  })

  it('returns expired with its slot when the deadline ends on the blockhash verdict', async () => {
    reached.mockReturnValue(true)
    expiredAt.mockReturnValue(900n)
    getSignatureStatuses.mockResolvedValue(noBundle())

    await expect(run()).resolves.toEqual({ kind: 'expired', slot: 900n })
  })
})
