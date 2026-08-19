import { sleep } from '@lifi/sdk'
import type { ConfirmationDeadline } from './createConfirmationDeadline.js'
import type { ConfirmationOutcome } from './types.js'

/**
 * Cadence of the detached deadline-advance loop. The deadline itself gates
 * real `isBlockhashValid` probes to `EXPIRY_PROBE_INTERVAL_MS`; this only
 * bounds how late the gate is re-checked, and therefore how late the first
 * probe fires (~0.4 s in). It is deliberately independent of the status-poll
 * interval, which each caller sets for its own endpoint's rate limits.
 */
export const DEADLINE_TICK_INTERVAL_MS = 400
/**
 * Consecutive status-read failures a branch tolerates before it stops polling
 * and throws — a hard consequence, so the budget must outlast a realistic
 * throttling window rather than a blip. Public endpoints throttle in ~10 s
 * windows; with the backoff below, ten consecutive failures span at least
 * 16.4 s of sleep (0.8 + 1.6 + 7 × 2 s) at the fastest poll interval, so a
 * burst of 429s at the start of confirmation degrades to slower polling
 * instead of failing the branch while the transaction is still landable.
 * The throw still lands ~17 s in — well inside the 90 s ceiling, so a truly
 * broken endpoint (e.g. "method not found") does not hold its branch open.
 *
 * Not to be confused with `MAX_PROBE_ERRORS`, which belongs to the blockhash
 * prober: that one counts failures at a ~7 s cadence and only degrades the
 * early exit, it never fails the branch.
 */
export const MAX_STATUS_READ_FAILURES = 10
/**
 * Ceiling on a single backoff sleep between failed status reads.
 *
 * It must stay below the `BRANCH_TIMEOUT_MS` − `CONFIRMATION_TIMEOUT_MS` gap
 * (5 s): the loop re-checks the deadline only after sleeping, so one backoff
 * sleep straddling the 90 s ceiling delays the final probe by up to this
 * much, and the final probe must still fit inside the gap. At 2 s the final
 * probe keeps at least 3 s of it. For a poller whose base interval already
 * meets this cap (the bundle poller), backoff is a no-op — its failure budget
 * holds on the base interval alone.
 */
export const STATUS_RETRY_BACKOFF_CAP_MS = 2_000

/**
 * Polls one status probe against one RPC until the deadline is reached, and
 * owns the verdict rules shared by the signature and the bundle branch.
 *
 * `probe` is one status read: a non-`null` resolution is a confirmation, a
 * `null` resolution answered but saw nothing yet, and a rejection is a failed
 * read. What is read — `getSignatureStatuses` for a signature,
 * `getBundleStatuses` plus enrichment for a bundle — stays at the call site;
 * the loop shape, the failure budget, and the verdict rules live here so the
 * two branches can never drift apart again.
 *
 * The deadline is advanced by a detached loop rather than inline between
 * polls: the blockhash probe is policy, not observation, and it runs against
 * the same connection the status reads use, so a probe that hangs must not
 * be able to stop status polling until the branch abort. The detached loop
 * stalling merely stops the early exit from advancing — the wall-clock
 * ceiling still bounds the branch, and the hung probe itself dies with the
 * caller's signal.
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
  /**
   * The third fact, read at verdict time: returns `true` when this RPC never
   * accepted the broadcast. Only consulted when the observation did not
   * complete — an endpoint that rejects every write but polled to the
   * deadline and observed nothing has still earned its `not-confirmed`.
   * Omitted by the bundle branch, whose send failure throws before polling.
   */
  neverBroadcast?: () => boolean
}): Promise<ConfirmationOutcome<T>> {
  const { deadline, signal, pollIntervalMs, probe, read, subject } = options

  let settled = false

  // Advances the deadline independently of the status reads. `tick` never
  // throws by contract; the catch guard below only protects the poll loop
  // from a violation of that contract.
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
    // "Did this RPC ever answer a status read?" — a read that resolves `null`
    // still answered. Only this separates "polled and saw nothing" from
    // "never got a word out of this endpoint", and the two must never be
    // reported the same way.
    let probeSucceeded = false

    while (!deadline.reached() && !signal.aborted) {
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
      // Exponential backoff after a failure, so a throttling burst is met
      // with a falling request rate instead of ten reads in a few seconds.
      const delay =
        failures === 0
          ? pollIntervalMs
          : Math.min(
              pollIntervalMs * 2 ** failures,
              STATUS_RETRY_BACKOFF_CAP_MS
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

    // A completed observation outranks everything below: this branch polled
    // to its deadline, ran its final probe, and saw nothing. The final probe
    // only runs when the branch was not aborted, so `!signal.aborted` is what
    // makes the observation complete.
    if (probeSucceeded && !signal.aborted) {
      return { kind: 'not-confirmed' }
    }

    // "This endpoint never accepted my broadcast" is the most useful fact
    // when nothing was observed either.
    if (options.neverBroadcast?.()) {
      throw new Error(
        `Every ${subject} send attempt against this RPC failed; the ${subject} was never submitted here.`
      )
    }

    // Reached when every status read hung until the branch was aborted: one
    // in-flight read is not `MAX_STATUS_READ_FAILURES` consecutive failures,
    // so the loop above never threw. Returning `not-confirmed` here would
    // report a hung endpoint as an expiry.
    if (!probeSucceeded) {
      throw new Error(
        `No ${read} against this RPC ever completed; the ${subject} was never observed here.`
      )
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
      `This RPC stopped answering before a final ${read} could run; the ${subject} was not observed near the deadline.`
    )
  } finally {
    settled = true
  }
}
