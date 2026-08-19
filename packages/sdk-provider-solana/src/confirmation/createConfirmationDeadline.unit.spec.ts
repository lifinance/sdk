import type { Blockhash } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'
import {
  type BlockhashProbeRpc,
  CONFIRMATION_TIMEOUT_MS,
  type ConfirmationDeadline,
  createConfirmationDeadline,
  EXPIRY_CONFIRMATIONS,
  EXPIRY_PROBE_INTERVAL_MS,
  MAX_PROBE_ERRORS,
} from './createConfirmationDeadline.js'
import { DEADLINE_TICK_INTERVAL_MS } from './pollUntilDeadline.js'

const isBlockhashValid = vi.fn()

const rpc = {
  isBlockhashValid: (blockhash: string, config?: unknown) => ({
    send: (options?: unknown) => isBlockhashValid(blockhash, config, options),
  }),
} as unknown as BlockhashProbeRpc

const blockhash = (value: string): TransactionLifetime => ({
  kind: 'blockhash',
  blockhash: value as Blockhash,
})

const signal = (): AbortSignal => new AbortController().signal

let currentTime = 0
const now = (): number => currentTime

const valid = (value: boolean) => ({ value })

/**
 * The window a healthy-but-lagging node plausibly needs to catch up to the
 * cluster tip. `isBlockhashValid` answers `false` for such a node exactly as
 * it does for a dead blockhash, so no expiry verdict may be reachable inside
 * this window. Nothing at runtime enforces it — the probe cadence is what
 * keeps the earliest verdict outside it, and the two tests below pin that.
 */
const NODE_LAG_WINDOW_MS = 12_000

/**
 * One tick that is guaranteed to probe: the poll loop calls `tick` far more
 * often than this, and the deadline drops the calls in between.
 */
const probeTick = async (deadline: ConfirmationDeadline): Promise<void> => {
  await deadline.tick(signal())
  currentTime += EXPIRY_PROBE_INTERVAL_MS
}

describe('createConfirmationDeadline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentTime = 0
  })

  it('is reached at the wall-clock ceiling even when nothing else fires', async () => {
    const deadline = createConfirmationDeadline({
      lifetimes: [{ kind: 'nonce' }],
      rpc,
      now,
    })

    currentTime = CONFIRMATION_TIMEOUT_MS - 1
    expect(deadline.reached()).toBe(false)

    currentTime = CONFIRMATION_TIMEOUT_MS
    expect(deadline.reached()).toBe(true)
  })

  it('makes zero RPC calls for a nonce lifetime', async () => {
    const deadline = createConfirmationDeadline({
      lifetimes: [{ kind: 'nonce' }],
      rpc,
      now,
    })

    await probeTick(deadline)
    await probeTick(deadline)

    expect(isBlockhashValid).not.toHaveBeenCalled()
  })

  it('makes zero RPC calls for an unknown lifetime', async () => {
    const deadline = createConfirmationDeadline({
      lifetimes: [{ kind: 'unknown' }],
      rpc,
      now,
    })

    await probeTick(deadline)

    expect(isBlockhashValid).not.toHaveBeenCalled()
  })

  it('makes zero RPC calls when any lifetime in the set is not a blockhash', async () => {
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A'), { kind: 'nonce' }],
      rpc,
      now,
    })

    await probeTick(deadline)

    expect(isBlockhashValid).not.toHaveBeenCalled()
  })

  it('makes zero RPC calls for an empty lifetime set and still reaches the ceiling', async () => {
    const deadline = createConfirmationDeadline({
      lifetimes: [],
      rpc,
      now,
    })

    await probeTick(deadline)

    expect(isBlockhashValid).not.toHaveBeenCalled()
    expect(deadline.reached()).toBe(false)

    currentTime = CONFIRMATION_TIMEOUT_MS
    expect(deadline.reached()).toBe(true)
  })

  it('probes at most once per EXPIRY_PROBE_INTERVAL_MS, however often tick is called', async () => {
    isBlockhashValid.mockResolvedValue(valid(true))
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })

    // Drive the real poll cadence for two probe intervals' worth of time.
    const ticks = (EXPIRY_PROBE_INTERVAL_MS * 2) / DEADLINE_TICK_INTERVAL_MS
    for (let attempt = 0; attempt < ticks; attempt += 1) {
      await deadline.tick(signal())
      currentTime += DEADLINE_TICK_INTERVAL_MS
    }

    // Probes at t=0 and t=EXPIRY_PROBE_INTERVAL_MS only. Without the interval
    // gate this would be one call per tick.
    expect(ticks).toBeGreaterThan(2)
    expect(isBlockhashValid).toHaveBeenCalledTimes(2)
  })

  it('expires after EXPIRY_CONFIRMATIONS consecutive false results', async () => {
    isBlockhashValid.mockResolvedValue(valid(false))
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })

    for (let attempt = 1; attempt < EXPIRY_CONFIRMATIONS; attempt += 1) {
      await probeTick(deadline)
      expect(deadline.reached()).toBe(false)
    }

    await probeTick(deadline)
    expect(deadline.reached()).toBe(true)
  })

  it('cannot report expiry inside the node-lag window at the real tick cadence', async () => {
    // There is no runtime floor in `reached()`: the probe cadence is the only
    // thing that makes an early verdict impossible. Driven at the real tick
    // cadence against an RPC that answers `false` on every probe — a lagging
    // node looks exactly like this — no verdict may exist inside the window.
    // Speeding up EXPIRY_PROBE_INTERVAL_MS without re-checking that relation
    // is the defect this pins: at the previous 3 s interval the verdict
    // landed at ~6.4 s, and this test fails.
    isBlockhashValid.mockResolvedValue(valid(false))
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })

    while (currentTime < NODE_LAG_WINDOW_MS) {
      await deadline.tick(signal())
      expect(deadline.reached()).toBe(false)
      currentTime += DEADLINE_TICK_INTERVAL_MS
    }
    expect(deadline.reached()).toBe(false)

    // Not vacuous: the same cadence does deliver the expiry verdict once the
    // third probe lands (~14.4 s in), well before the wall-clock ceiling.
    while (!deadline.reached() && currentTime < CONFIRMATION_TIMEOUT_MS) {
      await deadline.tick(signal())
      currentTime += DEADLINE_TICK_INTERVAL_MS
    }
    expect(deadline.reached()).toBe(true)
    expect(currentTime).toBeLessThan(CONFIRMATION_TIMEOUT_MS)
  })

  it('cannot reach an expiry verdict inside a plausible node-lag window', () => {
    // `isBlockhashValid` answers `false` both for a dead blockhash and for a
    // node that has not yet seen it, so the earliest possible verdict - the
    // first probe on the first tick, then EXPIRY_CONFIRMATIONS - 1 more at
    // the probe interval - must sit comfortably above the window a
    // healthy-but-lagging node needs to catch up. At the previous 3 s
    // interval the verdict could land at ~6.4 s; pinned here to stay at or
    // above NODE_LAG_WINDOW_MS (currently ~14.4 s).
    expect(
      DEADLINE_TICK_INTERVAL_MS +
        (EXPIRY_CONFIRMATIONS - 1) * EXPIRY_PROBE_INTERVAL_MS
    ).toBeGreaterThanOrEqual(NODE_LAG_WINDOW_MS)
  })

  it('resets the streak when a single true arrives', async () => {
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })

    isBlockhashValid.mockResolvedValue(valid(false))
    await probeTick(deadline)
    await probeTick(deadline)

    isBlockhashValid.mockResolvedValue(valid(true))
    await probeTick(deadline)
    // false, false, true is not an expiry.
    expect(deadline.reached()).toBe(false)

    isBlockhashValid.mockResolvedValue(valid(false))
    await probeTick(deadline)
    await probeTick(deadline)
    expect(deadline.reached()).toBe(false)

    await probeTick(deadline)
    expect(deadline.reached()).toBe(true)
  })

  it('clears an expiry it already reported once the blockhash reads valid again', async () => {
    isBlockhashValid.mockResolvedValue(valid(false))
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })

    for (let attempt = 0; attempt < EXPIRY_CONFIRMATIONS; attempt += 1) {
      await probeTick(deadline)
    }
    expect(deadline.reached()).toBe(true)

    // A node that lagged far enough to answer false three times must not
    // condemn a blockhash it then reports as alive. The verdict is derived
    // from the live streak, never latched.
    isBlockhashValid.mockResolvedValue(valid(true))
    await probeTick(deadline)
    expect(deadline.reached()).toBe(false)
  })

  it('probes every distinct blockhash and expires when any one expires', async () => {
    isBlockhashValid.mockImplementation((value: string) =>
      Promise.resolve(valid(value !== 'B'))
    )
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A'), blockhash('B'), blockhash('A')],
      rpc,
      now,
    })

    await probeTick(deadline)
    // 'A' appears twice but is probed once.
    expect(isBlockhashValid).toHaveBeenCalledTimes(2)

    await probeTick(deadline)
    await probeTick(deadline)
    expect(deadline.reached()).toBe(true)
  })

  it('keeps the expiry streak per blockhash rather than across the set', async () => {
    let failing = 'B'
    isBlockhashValid.mockImplementation((value: string) =>
      Promise.resolve(valid(value !== failing))
    )
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A'), blockhash('B')],
      rpc,
      now,
    })

    // A different blockhash fails on every probe, so neither ever returns false
    // twice in a row and neither expires.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      failing = attempt % 2 === 0 ? 'B' : 'A'
      await probeTick(deadline)
    }
    expect(deadline.reached()).toBe(false)

    // Three consecutive false results on 'B' alone do expire the set.
    failing = 'B'
    await probeTick(deadline)
    await probeTick(deadline)
    expect(deadline.reached()).toBe(false)

    await probeTick(deadline)
    expect(deadline.reached()).toBe(true)
  })

  it('keeps a healthy blockhash streak when a sibling probe fails', async () => {
    // The round used to be a `Promise.all` whose catch cleared every streak,
    // so one failing probe threw away the answers the round had already
    // produced for the other blockhashes. A bundle carrying several
    // blockhashes could then never reach a verdict on any of them - the early
    // exit was disabled exactly where several lifetimes race expiry.
    isBlockhashValid.mockImplementation((value: string) =>
      value === 'A'
        ? Promise.resolve(valid(false))
        : Promise.reject(new Error('this endpoint never answered'))
    )
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A'), blockhash('B')],
      rpc,
      now,
    })

    await probeTick(deadline)
    await probeTick(deadline)
    expect(deadline.reached()).toBe(false)

    // 'A' has now answered false three times. 'B' failing alongside it is not
    // evidence about 'A', so it must not reset 'A' streak. Three rounds also
    // stays under MAX_PROBE_ERRORS, so probing is still on.
    await probeTick(deadline)
    expect(deadline.reached()).toBe(true)
  })

  it('keeps probing a healthy blockhash after a sibling exhausts its error budget', async () => {
    // The error budget and the probing switch used to be shared by the whole
    // set, so one permanently broken sibling probe stopped probing for every
    // blockhash after MAX_PROBE_ERRORS - killing the early exit for a
    // blockhash whose own probes all succeeded.
    let aValid = true
    isBlockhashValid.mockImplementation((value: string) =>
      value === 'A'
        ? Promise.resolve(valid(aValid))
        : Promise.reject(new Error('this endpoint never answered'))
    )
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A'), blockhash('B')],
      rpc,
      now,
    })

    // 'B' spends its own budget and drops out. 'A' answers valid throughout,
    // so nothing has expired yet.
    for (let attempt = 0; attempt < MAX_PROBE_ERRORS + 1; attempt += 1) {
      await probeTick(deadline)
    }
    expect(deadline.reached()).toBe(false)

    // 'A' now dies. Its own probes still run, so the early exit still fires.
    aValid = false
    await probeTick(deadline)
    await probeTick(deadline)
    expect(deadline.reached()).toBe(false)

    await probeTick(deadline)
    expect(deadline.reached()).toBe(true)
  })

  it('stops probing after MAX_PROBE_ERRORS and degrades to ceiling-only', async () => {
    isBlockhashValid.mockRejectedValue(new Error('method not supported'))
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })

    for (let attempt = 0; attempt < MAX_PROBE_ERRORS + 3; attempt += 1) {
      await probeTick(deadline)
    }

    // Probing stopped; the extra ticks cost nothing.
    expect(isBlockhashValid).toHaveBeenCalledTimes(MAX_PROBE_ERRORS)
    // A probe failure must never be read as expiry.
    expect(deadline.reached()).toBe(false)

    currentTime = CONFIRMATION_TIMEOUT_MS
    expect(deadline.reached()).toBe(true)
  })

  it('resets the error streak when a probe succeeds between failures', async () => {
    let probe = 0
    isBlockhashValid.mockImplementation(() => {
      probe += 1
      return probe % 2 === 1
        ? Promise.reject(new Error('transient'))
        : Promise.resolve(valid(true))
    })
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })

    const ticks = MAX_PROBE_ERRORS * 2 + 2
    for (let attempt = 0; attempt < ticks; attempt += 1) {
      await probeTick(deadline)
    }

    // Failures are never consecutive, so the cap is never reached and probing
    // continues for every probe tick.
    expect(isBlockhashValid).toHaveBeenCalledTimes(ticks)
    expect(deadline.reached()).toBe(false)
  })

  it('clears the expiry streak when a probe fails', async () => {
    isBlockhashValid.mockResolvedValue(valid(false))
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })

    await probeTick(deadline)
    await probeTick(deadline)

    isBlockhashValid.mockRejectedValueOnce(new Error('transient'))
    await probeTick(deadline)

    isBlockhashValid.mockResolvedValue(valid(false))
    await probeTick(deadline)
    await probeTick(deadline)
    // The failed probe cleared the streak, so two false results are not enough.
    expect(deadline.reached()).toBe(false)

    await probeTick(deadline)
    expect(deadline.reached()).toBe(true)
  })

  it('hands the caller signal to every blockhash probe', async () => {
    // The poll loop's signal is the only way a hung `isBlockhashValid` call
    // ever ends. The probe must send the *caller's* signal, by identity - a
    // probe sent without it outlives the branch that asked for it.
    isBlockhashValid.mockResolvedValue(valid(true))
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A'), blockhash('B')],
      rpc,
      now,
    })
    const controller = new AbortController()

    await deadline.tick(controller.signal)

    expect(isBlockhashValid).toHaveBeenCalledTimes(2)
    for (const call of isBlockhashValid.mock.calls) {
      expect(call[2]).toEqual({ abortSignal: controller.signal })
    }
  })

  it('does not probe once the signal is aborted', async () => {
    isBlockhashValid.mockResolvedValue(valid(true))
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })
    const controller = new AbortController()
    controller.abort()

    await deadline.tick(controller.signal)

    expect(isBlockhashValid).not.toHaveBeenCalled()
  })
})
