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
 */
export async function raceRpcs<Rpc, T>(
  rpcs: Rpc[],
  run: (rpc: Rpc, signal: AbortSignal) => Promise<ConfirmationOutcome<T>>
): Promise<RaceResult<T>> {
  if (rpcs.length === 0) {
    return { kind: 'rpc-unavailable', errors: [] }
  }

  const controller = new AbortController()
  let resolveConfirmed: ((value: T) => void) | undefined
  const firstConfirmation = new Promise<T>((resolve) => {
    resolveConfirmed = resolve
  })

  const settled = Promise.allSettled(
    rpcs.map(async (rpc) => {
      const outcome = await run(rpc, controller.signal)
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
        // A confirmation can land in the same tick the batch settles.
        if (entry.value.kind === 'confirmed') {
          return { kind: 'confirmed', value: entry.value.value }
        }
        sawNotConfirmed = true
        continue
      }
      // Losing branches are cancelled on purpose; that is not a failure.
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
