import type { Signature } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SolanaRpcType } from '../rpc/types.js'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'

vi.mock('@lifi/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lifi/sdk')>()),
  // Resolved on a macrotask, not a microtask. `pollUntilDeadline` runs the
  // deadline-advance loop detached from the poll loop; a microtask-only sleep
  // lets the two starve each other instead of interleaving the way they do at
  // runtime, so the suite would be exercising a shape production never takes.
  sleep: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
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
const { MAX_STATUS_READ_FAILURES } = await import('./pollUntilDeadline.js')

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
    // MAX_STATUS_READ_FAILURES failures, none of them consecutive. Only a streak that
    // resets on every success stays below the throw threshold.
    for (let i = 0; i < MAX_STATUS_READ_FAILURES; i += 1) {
      getSignatureStatuses
        .mockRejectedValueOnce(new Error('502'))
        .mockResolvedValueOnce(noStatus())
    }
    getSignatureStatuses.mockResolvedValueOnce(status('confirmed'))

    const result = await run()

    expect(result.kind).toBe('confirmed')
    expect(getSignatureStatuses).toHaveBeenCalledTimes(
      MAX_STATUS_READ_FAILURES * 2 + 1
    )
  })

  it('throws after MAX_STATUS_READ_FAILURES consecutive probe failures', async () => {
    getSignatureStatuses.mockRejectedValue(new Error('method not found'))

    await expect(run()).rejects.toThrow('method not found')
    expect(getSignatureStatuses).toHaveBeenCalledTimes(MAX_STATUS_READ_FAILURES)
  })

  it('returns not-confirmed when every send failed but the observation completed', async () => {
    // The endpoint rejected every write yet answered status reads to the
    // deadline. A completed observation outranks the send-failure signal:
    // throwing here would surface a genuinely unconfirmed transaction as
    // rpc-unavailable instead of TransactionExpired - the inverse of the
    // outcome-collapse this rework removes.
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue(noStatus())
    const resend = vi.fn(() => Promise.reject(new Error('connection refused')))

    await expect(run(resend)).resolves.toEqual({ kind: 'not-confirmed' })
  })

  it('throws the send failure when nothing was observed either', async () => {
    // Sends failed AND no status read ever completed: the send failure is
    // the most useful fact, and not-confirmed would have no observation
    // behind it.
    const controller = new AbortController()
    reached.mockReturnValue(false)
    getSignatureStatuses.mockImplementation(() => {
      controller.abort()
      return Promise.reject(new Error('request aborted'))
    })
    const resend = vi.fn(() => Promise.reject(new Error('connection refused')))

    await expect(run(resend, controller.signal)).rejects.toThrow(
      /send attempt/i
    )
  })

  it('treats a { value: null } status payload as an answer, not a failed read', async () => {
    // An endpoint that responds `{ value: null }` said nothing, but it did
    // answer. Indexing into it unguarded throws a `TypeError` that burns a
    // read-failure slot - and in the final probe it voids the whole
    // observation, misreporting an answering endpoint as one that never
    // completed a read.
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue({ value: null })

    await expect(run()).resolves.toEqual({ kind: 'not-confirmed' })
  })

  it('reports the broadcast once the RPC accepts the first send', async () => {
    getSignatureStatuses.mockResolvedValue(status('confirmed'))
    const onBroadcast = vi.fn()
    // Every send after the first fails, so only the awaited first send can
    // report - this pins the first-send call site, not the resend loop's.
    const resend = vi
      .fn<Resend>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('later sends throttled'))

    await confirmSignature({
      rpc,
      signal: new AbortController().signal,
      signature: SIGNATURE,
      lifetimes: LIFETIMES,
      resend,
      onBroadcast,
    })

    expect(onBroadcast).toHaveBeenCalled()
  })

  it('reports the broadcast when only a later resend is accepted', async () => {
    // The first send fails; a resend from the detached loop is what the RPC
    // finally accepts. The broadcast report must come from that site too, or
    // an integrator whose endpoint rejected one write never gets a link.
    reached.mockReturnValue(false)
    getSignatureStatuses
      .mockResolvedValueOnce(noStatus())
      .mockResolvedValueOnce(noStatus())
      .mockResolvedValue(status('confirmed'))
    const onBroadcast = vi.fn()
    const resend = vi
      .fn<Resend>()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue(undefined)

    await confirmSignature({
      rpc,
      signal: new AbortController().signal,
      signature: SIGNATURE,
      lifetimes: LIFETIMES,
      resend,
      onBroadcast,
    })

    expect(resend.mock.calls.length).toBeGreaterThan(1)
    expect(onBroadcast).toHaveBeenCalled()
  })

  it('does not report a broadcast when every send fails', async () => {
    // The callback is the wait task's cue to publish an explorer link. An
    // endpoint that rejected every write never carried the transaction, so
    // it must not produce that cue.
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue(noStatus())
    const onBroadcast = vi.fn()

    await confirmSignature({
      rpc,
      signal: new AbortController().signal,
      signature: SIGNATURE,
      lifetimes: LIFETIMES,
      resend: vi.fn(() => Promise.reject(new Error('connection refused'))),
      onBroadcast,
    })

    expect(onBroadcast).not.toHaveBeenCalled()
  })

  it('returns not-confirmed when sends succeeded but nothing landed', async () => {
    reached.mockReturnValue(true)
    getSignatureStatuses.mockResolvedValue(noStatus())
    const resend = vi.fn(() => Promise.resolve())

    await expect(run(resend)).resolves.toEqual({ kind: 'not-confirmed' })
  })

  it('throws instead of returning not-confirmed when every status read hung', async () => {
    // A hung endpoint: the read is still in flight when the branch timeout
    // aborts it. That is one failure, so MAX_STATUS_READ_FAILURES never fires; the
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
    // Exactly one read, so the throw cannot be the MAX_STATUS_READ_FAILURES rule; and
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
    // thrower, and the second is one failure, so MAX_STATUS_READ_FAILURES cannot be
    // either. The send succeeded, ruling out the send rule too.
    expect(getSignatureStatuses).toHaveBeenCalledTimes(2)
  })

  it('does not report a resend that fulfils after the branch has settled', async () => {
    // A resend from the detached loop can fulfil in the gap after the poll
    // loop returned: the branch abort cannot retract an already-fulfilled
    // transport promise. Reporting the broadcast then would let a wait task
    // write PENDING over an execution it already marked DONE.
    reached.mockReturnValue(false)
    const onBroadcast = vi.fn()
    let releaseLoopSend!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseLoopSend = resolve
    })
    let loopSendInFlight = false
    const resend = vi
      .fn<Resend>()
      // The awaited first send fails, so the loop's send is the only call
      // site that could report - the exact zero-sends-before-confirmation
      // shape of the regression.
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockImplementation(() => {
        loopSendInFlight = true
        return gate
      })
    // Confirm only once the loop's send is in flight, so its fulfilment below
    // is guaranteed to land after the branch has settled.
    getSignatureStatuses.mockImplementation(() =>
      Promise.resolve(loopSendInFlight ? status('confirmed') : noStatus())
    )

    const result = await confirmSignature({
      rpc,
      signal: new AbortController().signal,
      signature: SIGNATURE,
      lifetimes: LIFETIMES,
      resend,
      onBroadcast,
    })

    expect(result.kind).toBe('confirmed')
    expect(loopSendInFlight).toBe(true)
    releaseLoopSend()
    // One macrotask turn lets the fulfilled resend run its continuation.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onBroadcast).not.toHaveBeenCalled()
  })

  it('does not report a first send that fulfils after the caller aborted', async () => {
    // The awaited-first-send mirror of the loop guard above: a losing
    // branch's first send can fulfil after another branch already won the
    // race and `raceRpcs` aborted this one. That late fulfilment must not
    // produce a broadcast report either.
    const controller = new AbortController()
    const onBroadcast = vi.fn()
    let releaseSend!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseSend = resolve
    })
    const resend = vi.fn<Resend>().mockImplementation(() => gate)
    getSignatureStatuses.mockResolvedValue(noStatus())

    const pending = confirmSignature({
      rpc,
      signal: controller.signal,
      signature: SIGNATURE,
      lifetimes: LIFETIMES,
      resend,
      onBroadcast,
    })
    // The race settles elsewhere while this first send is still in flight.
    controller.abort()
    releaseSend()

    // The branch never observed anything, so it refuses the verdict - but
    // the assertion under test is the callback, not the throw.
    await expect(pending).rejects.toThrow(/never observed here/i)
    expect(onBroadcast).not.toHaveBeenCalled()
  })
})
