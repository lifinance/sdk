import type { Blockhash } from '@solana/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransactionLifetime } from '../utils/getTransactionLifetime.js'
import {
  type BlockhashProbeRpc,
  CONFIRMATION_TIMEOUT_MS,
  createConfirmationDeadline,
  EXPIRY_CONFIRMATIONS,
  MAX_PROBE_ERRORS,
  MIN_CONFIRMATION_MS,
} from './createConfirmationDeadline.js'

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

    await deadline.tick(signal())
    await deadline.tick(signal())

    expect(isBlockhashValid).not.toHaveBeenCalled()
  })

  it('makes zero RPC calls for an unknown lifetime', async () => {
    const deadline = createConfirmationDeadline({
      lifetimes: [{ kind: 'unknown' }],
      rpc,
      now,
    })

    await deadline.tick(signal())

    expect(isBlockhashValid).not.toHaveBeenCalled()
  })

  it('makes zero RPC calls when any lifetime in the set is not a blockhash', async () => {
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A'), { kind: 'nonce' }],
      rpc,
      now,
    })

    await deadline.tick(signal())

    expect(isBlockhashValid).not.toHaveBeenCalled()
  })

  it('makes zero RPC calls for an empty lifetime set and still reaches the ceiling', async () => {
    const deadline = createConfirmationDeadline({
      lifetimes: [],
      rpc,
      now,
    })

    await deadline.tick(signal())

    expect(isBlockhashValid).not.toHaveBeenCalled()
    expect(deadline.reached()).toBe(false)

    currentTime = CONFIRMATION_TIMEOUT_MS
    expect(deadline.reached()).toBe(true)
  })

  it('expires after EXPIRY_CONFIRMATIONS consecutive false results', async () => {
    isBlockhashValid.mockResolvedValue(valid(false))
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })
    currentTime = MIN_CONFIRMATION_MS

    for (let attempt = 1; attempt < EXPIRY_CONFIRMATIONS; attempt += 1) {
      await deadline.tick(signal())
      expect(deadline.reached()).toBe(false)
    }

    await deadline.tick(signal())
    expect(deadline.reached()).toBe(true)
  })

  it('never reports expiry before the floor, however many false results arrive', async () => {
    isBlockhashValid.mockResolvedValue(valid(false))
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })

    currentTime = MIN_CONFIRMATION_MS - 1
    await deadline.tick(signal())
    await deadline.tick(signal())
    await deadline.tick(signal())
    await deadline.tick(signal())
    expect(deadline.reached()).toBe(false)

    currentTime = MIN_CONFIRMATION_MS
    expect(deadline.reached()).toBe(true)
  })

  it('resets the streak when a single true arrives', async () => {
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })
    currentTime = MIN_CONFIRMATION_MS

    isBlockhashValid.mockResolvedValue(valid(false))
    await deadline.tick(signal())
    await deadline.tick(signal())

    isBlockhashValid.mockResolvedValue(valid(true))
    await deadline.tick(signal())

    isBlockhashValid.mockResolvedValue(valid(false))
    await deadline.tick(signal())
    await deadline.tick(signal())
    expect(deadline.reached()).toBe(false)

    await deadline.tick(signal())
    expect(deadline.reached()).toBe(true)
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
    currentTime = MIN_CONFIRMATION_MS

    await deadline.tick(signal())
    // 'A' appears twice but is probed once.
    expect(isBlockhashValid).toHaveBeenCalledTimes(2)

    await deadline.tick(signal())
    await deadline.tick(signal())
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
    currentTime = MIN_CONFIRMATION_MS

    // A different blockhash fails on every tick, so neither ever returns false
    // twice in a row and neither expires.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      failing = attempt % 2 === 0 ? 'B' : 'A'
      await deadline.tick(signal())
    }
    expect(deadline.reached()).toBe(false)

    // Three consecutive false results on 'B' alone do expire the set.
    failing = 'B'
    await deadline.tick(signal())
    await deadline.tick(signal())
    expect(deadline.reached()).toBe(false)

    await deadline.tick(signal())
    expect(deadline.reached()).toBe(true)
  })

  it('stops probing after MAX_PROBE_ERRORS and degrades to ceiling-only', async () => {
    isBlockhashValid.mockRejectedValue(new Error('method not supported'))
    const deadline = createConfirmationDeadline({
      lifetimes: [blockhash('A')],
      rpc,
      now,
    })
    currentTime = MIN_CONFIRMATION_MS

    for (let attempt = 0; attempt < MAX_PROBE_ERRORS + 3; attempt += 1) {
      await deadline.tick(signal())
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
    currentTime = MIN_CONFIRMATION_MS

    const ticks = MAX_PROBE_ERRORS * 2 + 2
    for (let attempt = 0; attempt < ticks; attempt += 1) {
      await deadline.tick(signal())
    }

    // Failures are never consecutive, so the cap is never reached and probing
    // continues for every tick.
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
    currentTime = MIN_CONFIRMATION_MS

    await deadline.tick(signal())
    await deadline.tick(signal())

    isBlockhashValid.mockRejectedValueOnce(new Error('transient'))
    await deadline.tick(signal())

    isBlockhashValid.mockResolvedValue(valid(false))
    await deadline.tick(signal())
    await deadline.tick(signal())
    // The failed probe cleared the streak, so two false results are not enough.
    expect(deadline.reached()).toBe(false)

    await deadline.tick(signal())
    expect(deadline.reached()).toBe(true)
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
