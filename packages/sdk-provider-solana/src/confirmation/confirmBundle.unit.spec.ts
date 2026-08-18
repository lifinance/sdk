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
const { MAX_PROBE_ERRORS } = await import('./createConfirmationDeadline.js')

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
    // made and end in `TransactionExpired` for a landed bundle. The deadline
    // is bounded so a regression that keeps polling exits into a clean
    // assertion failure instead of spinning.
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
    // followed by a failing `getSignatureStatuses` must not count toward
    // MAX_PROBE_ERRORS and end as `rpc-unavailable` for a landed bundle.
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
    // aborts it. That is one failure, so MAX_PROBE_ERRORS never fires; the
    // loop then exits on the aborted signal and the final probe is skipped.
    // Reporting `not-confirmed` here would turn a hung RPC into
    // `TransactionExpired`, the exact misdiagnosis this rework removes.
    const controller = new AbortController()
    reached.mockReturnValue(false)
    getBundleStatuses.mockImplementation(() => {
      controller.abort()
      return Promise.reject(new Error('request aborted'))
    })

    await expect(run(controller.signal)).rejects.toThrow(/never observed here/i)
    // Exactly one read, so the throw cannot be the MAX_PROBE_ERRORS rule.
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

    await expect(run(controller.signal)).rejects.toThrow(
      /not observed near the deadline/i
    )
    // Two reads: the first answered, so the never-observed rule cannot be the
    // thrower, and the second is one failure, so MAX_PROBE_ERRORS cannot be
    // either.
    expect(getBundleStatuses).toHaveBeenCalledTimes(2)
  })
})
