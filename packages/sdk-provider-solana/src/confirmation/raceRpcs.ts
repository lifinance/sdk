import type { ConfirmationOutcome } from './types.js'

export type RaceResult<T> =
  | { kind: 'confirmed'; value: T }
  /** `slot`: the highest verdict slot of the branches. The transaction can
   * no longer land after it. */
  | { kind: 'expired'; slot: bigint; errors: Error[] }
  | { kind: 'not-confirmed'; errors: Error[] }
  | { kind: 'rpc-unavailable'; errors: Error[] }

/** Every result that is not a confirmation. Independent of the value type. */
export type UnconfirmedRaceResult = Exclude<
  RaceResult<unknown>,
  { kind: 'confirmed' }
>

const toError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason))

/**
 * Aborts when `signal` aborts or `timeoutMs` elapses, whichever is first.
 *
 * Not `AbortSignal.any` + `AbortSignal.timeout`: both are Baseline March 2024,
 * and a published SDK should not raise its runtime floor for a convenience one
 * controller and one timer already cover. The caller's signal is never aborted
 * here, so "caller aborted" and "timeout fired" stay distinguishable.
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
  // A pending timer keeps Node's event loop alive. `dispose` clears it; the
  // unref only covers a path that skips `dispose`.
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
 * Not `Promise.any`: it turns "polled and saw nothing" into a thrown sentinel,
 * collapsing the difference between an expired transaction and an RPC that
 * never answered - the defect that reported live swaps as `TransactionExpired`.
 * `timeoutMs` is the caller's; this module holds no confirmation policy.
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
  // Kept distinct: `controller` means "another branch confirmed", the timeout
  // means "this endpoint never answered". The timeout aborts the linked signal
  // only.
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
    let expiredAtSlot: bigint | undefined
    let sawNotConfirmed = false
    const errors: Error[] = []

    for (const entry of results) {
      if (entry.status === 'fulfilled') {
        // Unreachable today - `firstConfirmation` always wins - but keeps
        // `classify` correct if that structure changes.
        if (entry.value.kind === 'confirmed') {
          return { kind: 'confirmed', value: entry.value.value }
        }
        if (entry.value.kind === 'expired') {
          // The highest verdict slot: the strictest head a dropped check can
          // demand.
          if (expiredAtSlot === undefined || entry.value.slot > expiredAtSlot) {
            expiredAtSlot = entry.value.slot
          }
        } else {
          sawNotConfirmed = true
        }
        continue
      }
      // Cancelled branches are not failures. A branch the timeout killed is,
      // so its error is collected.
      if (controller.signal.aborted) {
        continue
      }
      errors.push(toError(entry.reason))
    }

    // A completed observation outranks a thrown error, but the collected
    // errors still travel with it as the expiry's `cause`.
    //
    // Among the observations, the ceiling outranks an expiry: `expired` may
    // end in a final "dropped", so every branch that observed has to agree
    // on it. A stale node alone must not drop a transaction that another
    // endpoint still watched to its ceiling.
    if (sawNotConfirmed) {
      return { kind: 'not-confirmed', errors }
    }
    if (expiredAtSlot !== undefined) {
      return { kind: 'expired', slot: expiredAtSlot, errors }
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

    return result
  } finally {
    // Cancels every in-flight branch on every path out, rejections included.
    // Must run before `dispose`, which detaches the listener carrying it.
    controller.abort()
    branch.dispose()
  }
}
