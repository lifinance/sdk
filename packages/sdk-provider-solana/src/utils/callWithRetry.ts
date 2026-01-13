/**
 * Calls a function on RPC instances with retry logic.
 * Tries each RPC in sequence until one succeeds.
 */
export async function callWithRetry<T, R>(
  rpcs: Map<string, T>,
  fn: (rpc: T) => Promise<R>
): Promise<R> {
  let lastError: unknown = null
  for (const rpc of rpcs.values()) {
    try {
      return await fn(rpc)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
