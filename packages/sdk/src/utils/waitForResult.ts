import { getAbortError } from './abort.js'
import { sleep } from './sleep.js'

/**
 * Repeatedly calls a given asynchronous function until it resolves with a truthy value
 * @param fn The function that should be repeated. A falsy result means "no result yet" and polls again, with no limit on the number of polls
 * @param interval The timeout in milliseconds between retries, or a function that receives the current poll count and returns the interval. Defaults to 5000
 * @param maxRetries Maximum number of calls that throw before the error is rethrown, defaults to 3
 * @param shouldRetry Optional predicate to determine if an error should trigger a retry
 * @param signal Optional signal that ends the wait: no call starts after it aborts, and the sleep between calls ends at once
 * @returns The result of the fn function
 * @throws The error of fn if maximum retries is reached, or if shouldRetry returns false
 * @throws The abort reason of `signal` once it aborts
 */
export const waitForResult = async <T>(
  fn: () => Promise<T | undefined>,
  interval: number | ((poll: number) => number) = 5000,
  maxRetries = 3,
  shouldRetry: (count: number, error: unknown) => boolean = () => true,
  signal?: AbortSignal
): Promise<T> => {
  let result: T | undefined
  let attempts = 0
  let polls = 0

  const getInterval = typeof interval === 'function' ? interval : () => interval

  while (!result) {
    if (signal?.aborted) {
      throw getAbortError(signal)
    }
    try {
      result = await fn()
    } catch (error) {
      // An error of a call that the abort cut short is not a reason to retry.
      if (signal?.aborted) {
        throw getAbortError(signal)
      }
      if (!shouldRetry(attempts, error)) {
        throw error
      }
      attempts++
      if (attempts === maxRetries) {
        throw error
      }
    }
    if (!result) {
      // Rejects at once, also when the signal aborted during the call.
      await sleep(getInterval(polls), { signal })
      polls++
    }
  }

  return result
}
