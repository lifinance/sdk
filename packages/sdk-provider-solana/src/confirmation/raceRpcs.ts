import type { ConfirmationOutcome } from './types.js'

export type RaceResult<T> =
  | { kind: 'confirmed'; value: T }
  | { kind: 'not-confirmed' }
  | { kind: 'rpc-unavailable'; errors: Error[] }

const toError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason))

/**
 * Returns a signal that aborts when `signal` aborts or when `timeoutMs`
 * elapses, whichever happens first.
 *
 * Deliberately not `AbortSignal.any([signal, AbortSignal.timeout(ms)])`. Both
 * of those are Baseline March 2024 (Node >= 20.3, Safari 17.4), no package in
 * this repo declares `engines` or a browserslist, and the newest API in any
 * shipped source is `structuredClone` (2022, `@lifi/sdk`'s `execution.ts`).
 * A published SDK must not raise its runtime floor for a convenience that one
 * controller and one timer already cover.
 *
 * The caller's own signal is never aborted here, so "the caller aborted" and
 * "the timeout fired" stay two distinguishable facts. `raceRpcs` depends on
 * that difference to tell a cancelled branch from a dead endpoint.
 *
 * `dispose` must run once the race settles: it clears the timer and detaches
 * the listener, so nothing is left behind on any path — including the
 * confirmation path, which settles long before the timeout would fire.
 */
function abortAfter(
  signal: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; dispose: () => void } {
  const linked = new AbortController()
  const forward = (): void => linked.abort(signal.reason)

  const timer = setTimeout(() => {
    linked.abort(new Error(`This RPC did not answer within ${timeoutMs}ms.`))
  }, timeoutMs)
  // Node keeps the event loop alive for a pending timer, which is what
  // `AbortSignal.timeout` avoided by unref'ing its own. `dispose` is what
  // really clears this one; the unref only covers a path that skips it. A
  // browser returns a number, which has no `unref`.
  const handle = timer as unknown as { unref?: () => void }
  handle.unref?.()

  if (signal.aborted) {
    forward()
  } else {
    signal.addEventListener('abort', forward, { once: true })
  }

  return {
    signal: linked.signal,
    dispose: (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', forward)
    },
  }
}

/**
 * Runs `run` against every RPC in parallel and reports the first confirmation.
 *
 * `Promise.any` is deliberately not used: it turns "polled and saw nothing"
 * into a thrown sentinel, which destroys the difference between a genuinely
 * expired transaction and an RPC that never answered. That collapse is why a
 * live RPC-compatibility defect was reported to users as `TransactionExpired`.
 *
 * `timeoutMs` is the caller's, not this module's: `raceRpcs` is generic over
 * `Rpc` and holds no confirmation policy. Every branch receives a signal that
 * aborts either when another branch confirms or when `timeoutMs` elapses, so
 * an endpoint that accepts the connection and never answers cannot hold the
 * race open — no HTTP transport in use here applies a timeout of its own.
 */
export async function raceRpcs<Rpc, T>(
  rpcs: Rpc[],
  run: (rpc: Rpc, signal: AbortSignal) => Promise<ConfirmationOutcome<T>>,
  options: { timeoutMs: number }
): Promise<RaceResult<T>> {
  if (rpcs.length === 0) {
    return { kind: 'rpc-unavailable', errors: [] }
  }

  const controller = new AbortController()
  // Two distinct sources, kept distinct on purpose: `controller` means "another
  // branch already confirmed, this one is redundant", while the timeout means
  // "this endpoint never answered". `classify` must not read them as the same
  // thing, so the timeout aborts the linked signal only and leaves `controller`
  // untouched.
  const branch = abortAfter(controller.signal, options.timeoutMs)

  let resolveConfirmed: ((value: T) => void) | undefined
  const firstConfirmation = new Promise<T>((resolve) => {
    resolveConfirmed = resolve
  })

  const settled = Promise.allSettled(
    rpcs.map(async (rpc) => {
      const outcome = await run(rpc, branch.signal)
      if (outcome.kind === 'confirmed') {
        resolveConfirmed?.(outcome.value)
        controller.abort()
      }
      return outcome
    })
  )

  const classify = (
    results: PromiseSettledResult<ConfirmationOutcome<T>>[]
  ): RaceResult<T> => {
    let sawNotConfirmed = false
    const errors: Error[] = []

    for (const entry of results) {
      if (entry.status === 'fulfilled') {
        // Unreachable safeguard: `resolveConfirmed` runs before the branch
        // promise settles, so `firstConfirmation` always wins the race
        // today. This keeps `classify` correct if that structure changes.
        if (entry.value.kind === 'confirmed') {
          return { kind: 'confirmed', value: entry.value.value }
        }
        sawNotConfirmed = true
        continue
      }
      // Losing branches are cancelled on purpose; that is not a failure. A
      // branch the timeout killed is a different matter — that endpoint really
      // is unavailable, so its error is collected rather than dropped.
      if (controller.signal.aborted) {
        continue
      }
      errors.push(toError(entry.reason))
    }

    if (sawNotConfirmed) {
      return { kind: 'not-confirmed' }
    }
    return { kind: 'rpc-unavailable', errors }
  }

  try {
    const result = await Promise.race([
      firstConfirmation.then(
        (value): RaceResult<T> => ({ kind: 'confirmed', value })
      ),
      settled.then(classify),
    ])

    // Cancels every branch still in flight. It has to run before `dispose`,
    // which detaches the listener that carries this abort to the branches.
    controller.abort()
    return result
  } finally {
    branch.dispose()
  }
}
