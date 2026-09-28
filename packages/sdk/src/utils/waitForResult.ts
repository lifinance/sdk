import { sleep } from './sleep.js'

/**
 * Repeatedly calls a given asynchronous function until it resolves with a value
 * @param fn The function that should be repeated. `undefined` or `null` means "no result yet" and polls again, with no limit on the number of polls
 * @param interval The timeout in milliseconds between retries, or a function that receives the current poll count and returns the interval. Defaults to 5000
 * @param maxRetries Maximum number of calls that throw before the error is rethrown, defaults to 3
 * @param shouldRetry Optional predicate to determine if an error should trigger a retry
 * @returns The result of the fn function
 * @throws The error of fn if maximum retries is reached, or if shouldRetry returns false
 */
export const waitForResult = async <T>(
  fn: () => Promise<T | undefined>,
  interval: number | ((poll: number) => number) = 5000,
  maxRetries = 3,
  shouldRetry: (count: number, error: unknown) => boolean = () => true
): Promise<T> => {
  let attempts = 0
  let polls = 0

  const getInterval = typeof interval === 'function' ? interval : () => interval

  while (true) {
    try {
      const result = await fn()
      if (result !== undefined && result !== null) {
        return result
      }
    } catch (error) {
      if (!shouldRetry(attempts, error)) {
        throw error
      }
      attempts++
      if (attempts >= maxRetries) {
        throw error
      }
    }
    await sleep(getInterval(polls))
    polls++
  }
}
