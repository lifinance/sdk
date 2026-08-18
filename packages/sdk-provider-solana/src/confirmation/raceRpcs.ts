import type { ConfirmationOutcome } from './types.js'

export type RaceResult<T> =
  | { kind: 'confirmed'; value: T }
  | { kind: 'not-confirmed' }
  | { kind: 'rpc-unavailable'; errors: Error[] }

const toError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason))

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
  // thing. `AbortSignal.timeout` uses an unref'd timer, so it never keeps a
  // process alive past the race.
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const branchSignal = AbortSignal.any([controller.signal, timeout])

  let resolveConfirmed: ((value: T) => void) | undefined
  const firstConfirmation = new Promise<T>((resolve) => {
    resolveConfirmed = resolve
  })

  const settled = Promise.allSettled(
    rpcs.map(async (rpc) => {
      const outcome = await run(rpc, branchSignal)
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

  const result = await Promise.race([
    firstConfirmation.then(
      (value): RaceResult<T> => ({ kind: 'confirmed', value })
    ),
    settled.then(classify),
  ])

  controller.abort()
  return result
}
