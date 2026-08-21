import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmationDeadline } from './createConfirmationDeadline.js'
import {
  BRANCH_TIMEOUT_MS,
  CONFIRMATION_TIMEOUT_MS,
} from './createConfirmationDeadline.js'

/** Every `sleep` duration requested, poll loop and deadline loop together. */
const sleepCalls: number[] = []

vi.mock('@lifi/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lifi/sdk')>()),
  // Resolved on a macrotask, not a microtask: the tests below leave probes
  // and ticks hanging, and a microtask-only sleep would let the detached
  // deadline-advance loop starve the event loop while the poll loop waits.
  sleep: (ms: number) => {
    sleepCalls.push(ms)
    return new Promise<void>((resolve) => setTimeout(resolve, 0))
  },
}))

const {
  DEADLINE_TICK_INTERVAL_MS,
  MAX_STATUS_READ_SILENCE_MS,
  STATUS_RETRY_BACKOFF_CAP_MS,
  pollUntilDeadline,
} = await import('./pollUntilDeadline.js')

const reached = vi.fn<() => boolean>()
const tick = vi.fn<() => Promise<void>>()
const deadline: ConfirmationDeadline = {
  reached: () => reached(),
  tick: () => tick(),
}

const probe = vi.fn<() => Promise<string | null>>()

const run = (
  overrides: {
    signal?: AbortSignal
    pollIntervalMs?: number
    neverBroadcast?: () => boolean
    now?: () => number
  } = {}
) =>
  pollUntilDeadline<string>({
    deadline,
    signal: overrides.signal ?? new AbortController().signal,
    pollIntervalMs: overrides.pollIntervalMs ?? 400,
    probe,
    read: 'signature status read',
    subject: 'transaction',
    neverBroadcast: overrides.neverBroadcast,
    now: overrides.now,
  })

describe('pollUntilDeadline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sleepCalls.length = 0
    reached.mockReturnValue(false)
    tick.mockResolvedValue(undefined)
  })

  it('confirms on a later poll, not only the first', async () => {
    probe
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('ok')

    await expect(run()).resolves.toEqual({ kind: 'confirmed', value: 'ok' })
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('returns not-confirmed when the deadline passes and the final probe sees nothing', async () => {
    reached.mockReturnValue(true)
    probe.mockResolvedValue(null)

    await expect(run()).resolves.toEqual({ kind: 'not-confirmed' })
    // The loop body never ran; only the final probe did.
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('keeps a completed observation when the branch timeout aborts the final probe', async () => {
    // BRANCH_TIMEOUT_MS is one shared timer, so every branch reaches the final
    // probe on the same clock. A probe killed there must not erase an
    // observation this branch already completed - `raceRpcs` would turn the
    // resulting throw into `rpc-unavailable` for a genuinely expired
    // transaction, the defect this module exists to prevent.
    const controller = new AbortController()
    reached.mockReturnValueOnce(false).mockReturnValue(true)
    probe.mockResolvedValueOnce(null).mockImplementationOnce(() => {
      controller.abort()
      return Promise.reject(new Error('request aborted'))
    })

    await expect(run({ signal: controller.signal })).resolves.toEqual({
      kind: 'not-confirmed',
    })
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('backs off after consecutive read failures instead of retrying at the poll interval', async () => {
    // A 429 burst must be met with a falling request rate: doubling from the
    // base interval, capped, and reset by the first read that answers.
    probe
      .mockRejectedValueOnce(new Error('429'))
      .mockRejectedValueOnce(new Error('429'))
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('ok')

    // 500 keeps the poll loop's sleeps distinguishable from the detached
    // deadline loop's DEADLINE_TICK_INTERVAL_MS sleeps.
    await expect(run({ pollIntervalMs: 500 })).resolves.toEqual({
      kind: 'confirmed',
      value: 'ok',
    })

    const pollSleeps = sleepCalls.filter(
      (ms) => ms !== DEADLINE_TICK_INTERVAL_MS
    )
    // Failures 1..3: 1000, 2000, then capped at 2000; the successful `null`
    // read resets the next sleep to the base interval.
    expect(pollSleeps).toEqual([1000, 2000, 2000, 500])
  })

  it('survives a 20 s throttling window instead of ending the branch inside it', async () => {
    // A public endpoint throttles for tens of seconds. Counting failures ended
    // the branch ~16 s in and reported rpc-unavailable for a transaction that
    // was already broadcast and could still land.
    const clock = { ms: 0 }
    probe.mockImplementation(() => {
      clock.ms += 2_000
      return clock.ms <= 20_000
        ? Promise.reject(new Error('429'))
        : Promise.resolve('ok')
    })

    await expect(run({ now: () => clock.ms })).resolves.toEqual({
      kind: 'confirmed',
      value: 'ok',
    })
  })

  it('throws a read failure once the endpoint has been silent for the whole window', async () => {
    const clock = { ms: 0 }
    probe.mockImplementation(() => {
      clock.ms += 5_000
      return Promise.reject(new Error('method not found'))
    })

    await expect(run({ now: () => clock.ms })).rejects.toThrow(
      'method not found'
    )
    // Measured from the last answer, so the branch gives up on the read that
    // closes the window - not on a fixed count of failures.
    expect(probe).toHaveBeenCalledTimes(MAX_STATUS_READ_SILENCE_MS / 5_000)
  })

  it('resets the silence budget after a successful read', async () => {
    // Twenty failures, none of them consecutive, spread over four times the
    // whole silence window. Only a budget that restarts on every answer
    // survives them.
    const clock = { ms: 0 }
    for (let i = 0; i < 20; i += 1) {
      probe
        .mockImplementationOnce(() => {
          clock.ms += 4_000
          return Promise.reject(new Error('502'))
        })
        .mockImplementationOnce(() => {
          clock.ms += 1_000
          return Promise.resolve(null)
        })
    }
    probe.mockResolvedValueOnce('ok')

    await expect(run({ now: () => clock.ms })).resolves.toEqual({
      kind: 'confirmed',
      value: 'ok',
    })
    expect(probe).toHaveBeenCalledTimes(41)
  })

  it('tolerates a longer silence than a public endpoint throttling window', () => {
    // Public endpoints throttle in windows of tens of seconds; the budget must
    // outlast one. A truly broken endpoint must still fail its branch well
    // inside the 90 s ceiling rather than hold it open to the end.
    expect(MAX_STATUS_READ_SILENCE_MS).toBeGreaterThan(20_000)
    expect(MAX_STATUS_READ_SILENCE_MS).toBeLessThan(CONFIRMATION_TIMEOUT_MS / 2)
  })

  it('never backs off to less than the base poll interval', async () => {
    // A base interval above STATUS_RETRY_BACKOFF_CAP_MS used to invert the
    // clamp: the failed read slept the 2 s cap while a successful one slept
    // the full 3 s, so failing an endpoint made the SDK poll it faster.
    probe
      .mockRejectedValueOnce(new Error('429'))
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce('ok')

    const pollIntervalMs = STATUS_RETRY_BACKOFF_CAP_MS + 1_000
    await expect(run({ pollIntervalMs })).resolves.toEqual({
      kind: 'confirmed',
      value: 'ok',
    })

    const pollSleeps = sleepCalls.filter(
      (ms) => ms !== DEADLINE_TICK_INTERVAL_MS
    )
    expect(pollSleeps.length).toBeGreaterThan(0)
    for (const slept of pollSleeps) {
      expect(slept).toBeGreaterThanOrEqual(pollIntervalMs)
    }
  })

  it('caps a single backoff sleep below the final-probe margin', () => {
    // One backoff sleep can straddle the 90 s ceiling; the final probe must
    // still fit inside the BRANCH_TIMEOUT_MS gap that protects it.
    expect(STATUS_RETRY_BACKOFF_CAP_MS).toBeLessThan(
      BRANCH_TIMEOUT_MS - CONFIRMATION_TIMEOUT_MS
    )
  })

  it('keeps reading statuses while a deadline tick hangs', async () => {
    // The blockhash probe is policy, not observation: a tick that hangs on a
    // dead connection must not stop status polling until the branch abort.
    // Inline `await deadline.tick(...)` in the poll loop fails this test by
    // timeout.
    tick.mockReturnValue(new Promise<never>(() => {}))
    probe
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('ok')

    await expect(run()).resolves.toEqual({ kind: 'confirmed', value: 'ok' })
  })

  it('advances the deadline while a status read hangs', async () => {
    // The inverse coupling: a status read that never answers must not stop
    // the deadline from advancing toward its early exit.
    probe.mockReturnValue(new Promise<never>(() => {}))
    const controller = new AbortController()

    const pending = run({ signal: controller.signal })
    pending.catch(() => {})

    await vi.waitFor(() => {
      expect(tick.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    controller.abort()
  })

  it('lets a completed observation outrank the send-failure signal', async () => {
    // An endpoint that rejects every write but answers status reads to the
    // deadline has earned its verdict: not-confirmed (TransactionExpired
    // upstream), never rpc-unavailable.
    reached.mockReturnValue(true)
    probe.mockResolvedValue(null)

    await expect(run({ neverBroadcast: () => true })).resolves.toEqual({
      kind: 'not-confirmed',
    })
  })

  it('throws the send failure when nothing was observed either', async () => {
    reached.mockReturnValue(true)
    probe.mockRejectedValue(new Error('read failed'))

    await expect(run({ neverBroadcast: () => true })).rejects.toThrow(
      /send to this RPC failed/i
    )
  })

  it('throws instead of returning not-confirmed when every status read hung', async () => {
    // A hung endpoint: the read is still in flight when the branch timeout
    // aborts it. One in-flight read is one failure, so the budget never
    // fires; the loop exits on the aborted signal and the final probe is
    // skipped.
    const controller = new AbortController()
    probe.mockImplementation(() => {
      controller.abort()
      return Promise.reject(new Error('request aborted'))
    })

    await expect(run({ signal: controller.signal })).rejects.toThrow(
      /ever completed/i
    )
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('throws instead of returning not-confirmed when the endpoint answers once and then goes dark', async () => {
    // An answer received early in the window must not stand in for one near
    // the deadline: a branch that answered once and then went dark has no
    // basis to report an expiry.
    const controller = new AbortController()
    probe.mockResolvedValueOnce(null).mockImplementationOnce(() => {
      controller.abort()
      return Promise.reject(new Error('request aborted'))
    })

    await expect(run({ signal: controller.signal })).rejects.toThrow(
      /stopped answering/i
    )
    expect(probe).toHaveBeenCalledTimes(2)
  })
})
