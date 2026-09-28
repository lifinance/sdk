import { getAbortError } from './abort.js'

/**
 * Resolves with `null` after `ms`. With a `signal`, it rejects with the abort
 * reason as soon as the signal aborts, and clears its timer.
 * Based on viem's `wait` (viem 2.56.9, `src/utils/wait.ts`).
 */
export function sleep(
  ms: number,
  { signal }: { signal?: AbortSignal | undefined } = {}
): Promise<null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(getAbortError(signal))
      return
    }

    const cleanup = (): void => signal?.removeEventListener('abort', onAbort)
    const timer = setTimeout(() => {
      cleanup()
      resolve(null)
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      cleanup()
      reject(getAbortError(signal!))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
