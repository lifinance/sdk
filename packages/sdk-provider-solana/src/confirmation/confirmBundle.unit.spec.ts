import type { Signature } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JitoRpcType } from '../rpc/types.js'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'

/** Every `sleep` duration requested, poll loop and deadline loop together. */
const sleepCalls: number[] = []

vi.mock('@lifi/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lifi/sdk')>()),
  // Macrotask, not microtask - see pollUntilDeadline.unit.spec.ts.
  sleep: (ms: number) => {
    sleepCalls.push(ms)
    return new Promise<void>((resolve) => setTimeout(resolve, 0))
  },
}))

const reached = vi.fn<() => boolean>()
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
      tick: () => tick(),
    }
  },
}))

const { confirmBundle } = await import('./confirmBundle.js')
const { DEADLINE_TICK_INTERVAL_MS } = await import('./pollUntilDeadline.js')

const getBundleStatuses = vi.fn()
const getSignatureStatuses = vi.fn()

/** Options every `getBundleStatuses(...).send(...)` call received. */
const bundleSendOptions: unknown[] = []
/** Options every `getSignatureStatuses(...).send(...)` call received. */
const signatureSendOptions: unknown[] = []

const rpc = {
  getBundleStatuses: (...args: unknown[]) => ({
    send: (options: unknown) => {
      bundleSendOptions.push(options)
      return getBundleStatuses(...args)
    },
  }),
  getSignatureStatuses: (...args: unknown[]) => ({
    send: (options: unknown) => {
      signatureSendOptions.push(options)
      return getSignatureStatuses(...args)
    },
  }),
} as unknown as JitoRpcType

const TX_SIGNATURES = ['sigA', 'sigB'] as Signature[]
const LIFETIMES: TransactionLifetime[] = [{ kind: 'unknown' }]

const bundle = (confirmation_status: string | null) => ({
  value: [{ confirmation_status, transactions: TX_SIGNATURES }],
})
const noBundle = () => ({ value: [null] })

const send = vi.fn(() => {
  events.push('send')
  return Promise.resolve('bundle-1')
})

const run = (signal: AbortSignal = new AbortController().signal) =>
  confirmBundle({
    rpc,
    signal,
    lifetimes: LIFETIMES,
    send,
  })

describe('confirmBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    deadlineCalls.length = 0
    bundleSendOptions.length = 0
    signatureSendOptions.length = 0
    sleepCalls.length = 0
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
    // The deadline now advances on its own detached cadence (pinned in
    // pollUntilDeadline.unit.spec.ts), so no per-iteration tick count is
    // asserted here.
  })

  it('polls bundle statuses no faster than the documented Jito rate limit', async () => {
    // Jito's own block engine documents a default limit of 1 request per
    // second per IP per region. The signature poller's 400 ms cadence (2.5
    // req/s) would exceed it on its own, so the bundle poller must keep its
    // own, slower interval.
    getBundleStatuses
      .mockResolvedValueOnce(noBundle())
      .mockResolvedValueOnce(bundle('confirmed'))
    getSignatureStatuses.mockResolvedValue({ value: [null, null] })

    const result = await run()

    expect(result.kind).toBe('confirmed')
    const pollSleeps = sleepCalls.filter(
      (ms) => ms !== DEADLINE_TICK_INTERVAL_MS
    )
    expect(pollSleeps.length).toBeGreaterThan(0)
    for (const ms of pollSleeps) {
      expect(ms).toBeGreaterThanOrEqual(1000)
    }
  })

  it('hands the caller signal to the bundle and signature reads', async () => {
    // The abort signal is the only way `raceRpcs` and `BRANCH_TIMEOUT_MS` can
    // end a read that hangs. A read sent without it never rejects, the race
    // never settles, and the task hangs forever - so the *caller's* signal
    // must reach the transport on every read, by identity.
    const controller = new AbortController()
    reached.mockReturnValueOnce(false)
    getBundleStatuses
      .mockResolvedValueOnce(noBundle())
      .mockResolvedValueOnce(bundle('confirmed'))
    getSignatureStatuses.mockResolvedValue({ value: [null, null] })

    const result = await run(controller.signal)

    expect(result.kind).toBe('confirmed')
    expect(bundleSendOptions).toHaveLength(2)
    for (const options of bundleSendOptions) {
      expect(options).toEqual({ abortSignal: controller.signal })
    }
    expect(signatureSendOptions).toEqual([{ abortSignal: controller.signal }])
  })

  it('builds the deadline from the caller lifetimes and rpc', async () => {
    // The deadline factory owns the whole blockhash-expiry policy. Handing it
    // an empty lifetime set silently disables that policy and degrades every
    // confirmation to the 90 s ceiling, so the hand-off itself is pinned.
    reached.mockReturnValue(true)
    getBundleStatuses.mockResolvedValue(noBundle())

    await run()

    expect(deadlineCalls).toEqual([{ lifetimes: LIFETIMES, rpc }])
  })

  it('enriches the confirmation with statuses for the transactions the bundle reported', async () => {
    // The signature query must ask about the bundle's own transactions - a
    // query for anything else silently strips the `err` details that the
    // defence-in-depth scan in `SolanaJitoWaitForTransactionTask` relies on.
    // The returned payload must also be the one surfaced: a usable response
    // must not be replaced by the all-null degrade.
    const err = { InstructionError: [0, 'AccountInUse'] }
    getBundleStatuses.mockResolvedValue(bundle('confirmed'))
    getSignatureStatuses.mockResolvedValue({ value: [{ err: null }, { err }] })

    const result = await run()

    expect(getSignatureStatuses).toHaveBeenCalledTimes(1)
    expect(getSignatureStatuses).toHaveBeenCalledWith(TX_SIGNATURES)
    if (result.kind !== 'confirmed') {
      throw new Error('unreachable')
    }
    expect(result.value.signatureResults).toEqual([{ err: null }, { err }])
  })

  it('confirms with all-null signature results when the signature payload is unusable', async () => {
    // The bundle status is the atomic fact: `confirmed` means every
    // transaction in the bundle landed. A missing `getSignatureStatuses`
    // payload must degrade to `null` results - the enrichment is for the
    // `err` scan only - not veto a confirmation the bundle status already
    // made and end in `TransactionExpired` for a landed bundle.
    reached.mockReturnValueOnce(false).mockReturnValue(true)
    getBundleStatuses.mockResolvedValue(bundle('confirmed'))
    getSignatureStatuses.mockResolvedValue({ value: null })

    await expect(run()).resolves.toEqual({
      kind: 'confirmed',
      value: {
        bundleId: 'bundle-1',
        txSignatures: TX_SIGNATURES,
        signatureResults: [null, null],
      },
    })
    // Confirmed on the first read: a loop that kept polling for a usable
    // payload would read more than once.
    expect(getBundleStatuses).toHaveBeenCalledTimes(1)
  })

  it('confirms with all-null signature results when the signature read fails', async () => {
    // Same atomicity argument for a thrown read: a confirmed bundle status
    // followed by a failing `getSignatureStatuses` must not spend the
    // MAX_STATUS_READ_SILENCE_MS budget and end as `rpc-unavailable` for a
    // landed bundle.
    getBundleStatuses.mockResolvedValue(bundle('confirmed'))
    getSignatureStatuses.mockRejectedValue(new Error('502'))

    await expect(run()).resolves.toEqual({
      kind: 'confirmed',
      value: {
        bundleId: 'bundle-1',
        txSignatures: TX_SIGNATURES,
        signatureResults: [null, null],
      },
    })
    expect(getBundleStatuses).toHaveBeenCalledTimes(1)
  })

  it('does not report a broadcast that fulfils after the branch was aborted', async () => {
    // The caller's once-guard latches only after the callback returns, so a
    // throwing hook leaves it open; a late fulfilment would then re-write a
    // finalized action back to PENDING.
    const controller = new AbortController()
    const onBroadcast = vi.fn()
    getBundleStatuses.mockResolvedValue(bundle('confirmed'))
    getSignatureStatuses.mockResolvedValue({ value: [null, null] })
    controller.abort()

    await confirmBundle({
      rpc,
      signal: controller.signal,
      lifetimes: LIFETIMES,
      send,
      onBroadcast,
    }).catch(() => undefined)

    expect(onBroadcast).not.toHaveBeenCalled()
  })

  it('confirms when `transactions` is a non-array payload', async () => {
    // `??` tests null/undefined alone, so a truthy non-array kept the module's
    // array type and threw a TypeError out of `.map` - reported as
    // UnknownError for a bundle that landed. main guarded this.
    getBundleStatuses.mockResolvedValue({
      value: [{ confirmation_status: 'confirmed', transactions: 'sigA' }],
    })

    await expect(run()).resolves.toEqual({
      kind: 'confirmed',
      value: { bundleId: 'bundle-1', txSignatures: [], signatureResults: [] },
    })
  })

  it('confirms when getSignatureStatuses returns a non-array value', async () => {
    // Same hole one level down: `SolanaJitoWaitForTransactionTask` calls
    // `.find()` on `signatureResults`.
    getBundleStatuses.mockResolvedValue(bundle('confirmed'))
    getSignatureStatuses.mockResolvedValue({ value: 'not-an-array' })

    await expect(run()).resolves.toEqual({
      kind: 'confirmed',
      value: {
        bundleId: 'bundle-1',
        txSignatures: TX_SIGNATURES,
        signatureResults: [null, null],
      },
    })
  })

  it('confirms a status that carries no transactions list at all', async () => {
    // `transactions` is unvalidated wire data. Before the guard, a confirmed
    // status arriving without it made `txSignatures.map` a `TypeError` on the
    // failing-read path - thrown out of the probe on every poll, spending the
    // MAX_STATUS_READ_SILENCE_MS budget, and ending as `rpc-unavailable` for a
    // bundle that had already landed.
    getBundleStatuses.mockResolvedValue({
      value: [{ confirmation_status: 'confirmed' }],
    })
    getSignatureStatuses.mockRejectedValue(
      new Error('invalid params: signatures must be an array')
    )

    await expect(run()).resolves.toEqual({
      kind: 'confirmed',
      value: {
        bundleId: 'bundle-1',
        txSignatures: [],
        signatureResults: [],
      },
    })
    expect(getBundleStatuses).toHaveBeenCalledTimes(1)
    // Nothing to enrich, so the signature read is never attempted.
    expect(getSignatureStatuses).not.toHaveBeenCalled()
  })

  it('confirms in the final probe even when the signature payload is unusable', async () => {
    // The final probe and the loop body share `readBundle`, so the two must
    // agree: a confirmed bundle status confirms here too, `null` payload or
    // not.
    reached.mockReturnValue(true)
    getBundleStatuses.mockResolvedValue(bundle('confirmed'))
    getSignatureStatuses.mockResolvedValue({ value: null })

    await expect(run()).resolves.toEqual({
      kind: 'confirmed',
      value: {
        bundleId: 'bundle-1',
        txSignatures: TX_SIGNATURES,
        signatureResults: [null, null],
      },
    })
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

  it('treats a { value: null } bundle payload as an answer, not a failed read', async () => {
    // An endpoint that responds `{ value: null }` said nothing, but it did
    // answer. Indexing into it unguarded throws a `TypeError` that burns a
    // read-failure slot - and in the final probe it voids the whole
    // observation, misreporting an answering endpoint as one that never
    // completed a read.
    reached.mockReturnValue(true)
    getBundleStatuses.mockResolvedValue({ value: null })

    await expect(run()).resolves.toEqual({ kind: 'not-confirmed' })
  })

  it('carries the bundle-level err verbatim into the confirmation', async () => {
    // The wait task's defence-in-depth scan reads it - shape-aware, because
    // a landed bundle carries the truthy `{ Ok: null }`. This module only
    // transports it; interpreting the Result shape is the task's job.
    const err = { Ok: null }
    getBundleStatuses.mockResolvedValue({
      value: [
        {
          confirmation_status: 'confirmed',
          transactions: TX_SIGNATURES,
          err,
        },
      ],
    })
    getSignatureStatuses.mockResolvedValue({ value: [null, null] })

    const result = await run()

    if (result.kind !== 'confirmed') {
      throw new Error('unreachable')
    }
    expect(result.value.bundleErr).toBe(err)
  })

  it('reports the broadcast once the submission is accepted', async () => {
    reached.mockReturnValue(true)
    getBundleStatuses.mockResolvedValue(noBundle())
    const onBroadcast = vi.fn()

    await confirmBundle({
      rpc,
      signal: new AbortController().signal,
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
      getBundleStatuses
        .mockRejectedValueOnce(new Error('502'))
        .mockResolvedValueOnce(noBundle())
    }
    getBundleStatuses.mockResolvedValueOnce(bundle('confirmed'))
    getSignatureStatuses.mockResolvedValue({ value: [null, null] })

    const result = await run()

    expect(result.kind).toBe('confirmed')
    expect(getBundleStatuses).toHaveBeenCalledTimes(41)
  })

  it('builds the deadline before it submits the bundle', async () => {
    // `BRANCH_TIMEOUT_MS` starts when the branch starts. A deadline built
    // after the submission returns would push the 90 s ceiling past the
    // branch's own timeout, and a slow `sendBundle` would eat the margin that
    // protects the final probe.
    reached.mockReturnValue(true)
    getBundleStatuses.mockResolvedValue(noBundle())

    await run()

    expect(events).toEqual(['deadline', 'send'])
  })

  it('propagates a submission failure instead of reporting not-confirmed', async () => {
    send.mockRejectedValueOnce(new Error('jito rejected the bundle'))

    await expect(run()).rejects.toThrow('jito rejected the bundle')
    expect(getBundleStatuses).not.toHaveBeenCalled()
  })

  it('throws instead of returning not-confirmed when every status read hung', async () => {
    // A hung endpoint: the read is still in flight when the branch timeout
    // aborts it. An in-flight read never answers, so it never renews the
    // silence budget and never throws either - the abort arrives first. The
    // loop then exits on the aborted signal and the final probe is skipped.
    const controller = new AbortController()
    reached.mockReturnValue(false)
    getBundleStatuses.mockImplementation(() => {
      controller.abort()
      return Promise.reject(new Error('request aborted'))
    })

    await expect(run(controller.signal)).rejects.toThrow(/ever completed/i)
    // Exactly one read, so the throw cannot be the silence-budget rule.
    expect(getBundleStatuses).toHaveBeenCalledTimes(1)
  })

  it('throws instead of returning not-confirmed when the endpoint answers once and then hangs', async () => {
    // One good read, then a read that stays in flight until the branch is
    // aborted. A flag that latches on the first answer would report
    // `not-confirmed` on one second of actual observation; the branch must
    // instead refuse the verdict, because it never observed the endpoint near
    // the deadline and `not-confirmed` outranks every error in `raceRpcs`.
    const controller = new AbortController()
    reached.mockReturnValue(false)
    getBundleStatuses
      .mockResolvedValueOnce(noBundle())
      .mockImplementationOnce(() => {
        controller.abort()
        return Promise.reject(new Error('request aborted'))
      })

    await expect(run(controller.signal)).rejects.toThrow(/stopped answering/i)
    // Two reads: the first answered, so the never-observed rule cannot be the
    // thrower, and the second never renewed the silence budget, so that rule
    // cannot be either.
    expect(getBundleStatuses).toHaveBeenCalledTimes(2)
  })
})
