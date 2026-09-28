import { isAbortError } from './abort.js'

/**
 * Wraps a function in a timeout.
 * Based on viem's withTimeout (viem 2.56.9, `src/utils/promise/withTimeout.ts`).
 * @param fn - The function to wrap.
 * @param timeout - The timeout in milliseconds.
 * @param errorInstance - The error instance to throw when the timeout is reached.
 * @param signal - Whether or not the timeout should use an abort signal.
 * @returns The result of the function.
 */
export function withTimeout<T>(
  fn: ({ signal }: { signal: AbortController['signal'] | null }) => Promise<T>,
  {
    errorInstance = new Error('Timed out after waiting for too long.'),
    timeout,
    signal,
  }: {
    // The error instance to throw when the timeout is reached.
    errorInstance?: Error | undefined
    // The timeout (in ms).
    timeout: number
    // Whether or not the timeout should use an abort signal.
    signal?: boolean | undefined
  }
): Promise<T> {
  return new Promise((resolve, reject) => {
    ;(async () => {
      let timeoutId!: NodeJS.Timeout
      const controller = new AbortController()
      try {
        if (timeout > 0) {
          timeoutId = setTimeout(() => {
            if (signal) {
              controller.abort()
            } else {
              reject(errorInstance)
            }
          }, timeout) as NodeJS.Timeout // need to cast because bun globals.d.ts overrides @types/node
        }
        resolve(await fn({ signal: controller?.signal || null }))
      } catch (err) {
        // Only an abort from our own timeout is a timeout. Any other
        // AbortError belongs to the caller and passes through.
        if (controller.signal.aborted && isAbortError(err)) {
          reject(errorInstance)
          return
        }
        reject(err)
      } finally {
        clearTimeout(timeoutId)
      }
    })()
  })
}
