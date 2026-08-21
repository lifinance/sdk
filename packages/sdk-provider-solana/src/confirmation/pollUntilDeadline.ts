import { sleep } from '@lifi/sdk'
import type { ConfirmationDeadline } from './createConfirmationDeadline.js'
import type { ConfirmationOutcome } from './types.js'

/** Cadence of the detached deadline-advance loop. Independent of the
 * status-poll interval, which each caller sets for its own rate limits. */
export const DEADLINE_TICK_INTERVAL_MS = 400
/** Consecutive status-read failures before a branch throws. With the backoff
 * below, ten failures span ~16.4 s - longer than a ~10 s throttling window,
 * and well inside the 90 s ceiling. */
export const MAX_STATUS_READ_FAILURES = 10
/** Ceiling on one backoff sleep. Must stay below `FINAL_PROBE_MARGIN_MS`: a
 * sleep straddling the ceiling delays the final probe by up to this much. */
export const STATUS_RETRY_BACKOFF_CAP_MS = 2_000

/**
 * Polls one probe against one RPC until the deadline, and owns the verdict
 * rules shared by the signature and bundle branches.
 *
 * `probe` resolves non-`null` for a confirmation, `null` for "answered, saw
 * nothing", and rejects for a failed read. The deadline advances on a detached
 * loop so a hung blockhash probe cannot stop status polling.
 */
export async function pollUntilDeadline<T>(options: {
  deadline: ConfirmationDeadline
  signal: AbortSignal
  /** Sleep between two status reads that answered. */
  pollIntervalMs: number
  /** One status read. `null` means it answered but saw no confirmation. */
  probe: () => Promise<T | null>
  /** Names the read in error messages, e.g. 'signature status read'. */
  read: string
  /** Names the thing being confirmed in error messages, e.g. 'transaction'. */
  subject: string
  /** `true` when this RPC never accepted the broadcast. Read at verdict time,
   * and only when the observation did not complete. */
  neverBroadcast?: () => boolean
}): Promise<ConfirmationOutcome<T>> {
  const { deadline, signal, pollIntervalMs, probe, read, subject } = options

  let settled = false

  // Advances the deadline independently of the status reads.
  const advancing = (async () => {
    while (!settled && !signal.aborted) {
      await sleep(DEADLINE_TICK_INTERVAL_MS)
      if (settled || signal.aborted) {
        break
      }
      await deadline.tick(signal)
    }
  })()
  advancing.catch(() => {})

  try {
    let failures = 0
    // Did this RPC ever answer? A `null` read still answered. Separates
    // "polled and saw nothing" from "never got a word out of this endpoint".
    let probeSucceeded = false

    // Records WHY the loop ended, because the two reasons earn different
    // verdicts. Reaching the deadline is a complete observation; being aborted
    // mid-read is not. The final probe below is a bonus on top of a complete
    // observation, so losing it must not downgrade the verdict.
    let deadlineReached = false
    while (!signal.aborted) {
      if (deadline.reached()) {
        deadlineReached = true
        break
      }
      try {
        const value = await probe()
        failures = 0
        probeSucceeded = true
        if (value !== null) {
          return { kind: 'confirmed', value }
        }
      } catch (error) {
        failures += 1
        if (failures >= MAX_STATUS_READ_FAILURES) {
          throw error
        }
      }
      // Exponential backoff, so a throttling burst meets a falling rate. The
      // outer `max` stops the cap inverting it for a caller whose base
      // interval already exceeds the cap.
      const delay =
        failures === 0
          ? pollIntervalMs
          : Math.max(
              pollIntervalMs,
              Math.min(
                pollIntervalMs * 2 ** failures,
                STATUS_RETRY_BACKOFF_CAP_MS
              )
            )
      await sleep(delay)
    }

    // The status may have flipped between the last poll and the deadline
    // being reached.
    if (!signal.aborted) {
      try {
        const value = await probe()
        probeSucceeded = true
        if (value !== null) {
          return { kind: 'confirmed', value }
        }
      } catch (_) {
        // The loop already ran. One failed final probe is not evidence that
        // this RPC is unusable.
      }
    }

    // A completed observation outranks everything below: polled to its own
    // deadline and saw nothing. It stays ahead of the send-failure signal on
    // purpose - a throw here is bucketed as `rpc-unavailable` by `raceRpcs`,
    // which would discard a real observation and misreport a genuinely expired
    // transaction as an outage. The never-broadcast case is answered one level
    // up, in the actions, which know whether ANY branch accepted the send.
    //
    // Keyed on `deadlineReached`, not on `!signal.aborted`: the final probe is
    // a bonus on top of the observation, and the shared BRANCH_TIMEOUT_MS timer
    // can abort that probe in every branch at once. Reading the abort here
    // would discard every observation and report a fleet-wide expiry as an
    // outage.
    if (probeSucceeded && deadlineReached) {
      return { kind: 'not-confirmed' }
    }

    if (options.neverBroadcast?.()) {
      throw new Error(`Every ${subject} send to this RPC failed.`)
    }

    // Every read hung until the abort: one in-flight read never reaches
    // `MAX_STATUS_READ_FAILURES`, so the loop never threw. `not-confirmed`
    // here would report a hung endpoint as an expiry.
    if (!probeSucceeded) {
      throw new Error(`No ${read} against this RPC ever completed.`)
    }

    // Exiting via `signal.aborted` means the final observation never
    // happened — an in-flight read held the loop until the abort cut it off.
    // An answer received early in the window must not stand in for one near
    // the deadline: a branch that answered once and then went dark has no
    // basis to call the subject of the read expired. (A branch aborted because another
    // RPC already confirmed also throws here; `raceRpcs` drops a losing
    // branch's error once its controller has aborted, so nothing is
    // misreported.)
    throw new Error(
      `This RPC stopped answering before a final ${read} could run.`
    )
  } finally {
    settled = true
  }
}
