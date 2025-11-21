/**
 * Wraps a function in a timeout.
 * Based on viem's withTimeout implementation.
 * @param fn - The function to wrap.
 * @param timeout - The timeout in milliseconds.
 * @param errorInstance - The error instance to throw when the timeout is reached.
 * @param signal - Whether or not the timeout should use an abort signal.
 * @returns The result of the function.
 */
export function withTimeout<T>(
  fn: ({ signal }: { signal: AbortController['signal'] | null }) => Promise<T>,
  {
    errorInstance = new Error('timed out'),
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
      try {
        const controller = new AbortController()
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
        if ((err as Error)?.name === 'AbortError') {
          reject(errorInstance)
        }
        reject(err)
      } finally {
        clearTimeout(timeoutId)
      }
    })()
  })
}
