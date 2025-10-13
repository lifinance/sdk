import { sleep } from './sleep.js'

/**
 * Repeatedly calls a given asynchronous function until it resolves with a value
 * @param fn The function that should be repeated
 * @param interval The timeout in milliseconds between retries, defaults to 5000
 * @param maxRetries Maximum number of retries before throwing an error, defaults to 3
 * @param shouldRetry Optional predicate to determine if an error should trigger a retry
 * @returns The result of the fn function
 * @throws Error if maximum retries is reached, if function keeps returning undefined, or if shouldRetry returns false
 */
export const waitForResult = async <T>(
  fn: () => Promise<T | undefined>,
  interval = 5000,
  maxRetries = 3,
  shouldRetry: (count: number, error: unknown) => boolean = () => true
): Promise<T> => {
  let result: T | undefined
  let attempts = 0

  while (!result) {
    try {
      result = await fn()
      if (!result) {
        await sleep(interval)
      }
    } catch (error) {
      if (!shouldRetry(attempts, error)) {
        throw error
      }
      attempts++
      if (attempts === maxRetries) {
        throw error
      }
      await sleep(interval)
    }
  }

  return result
}
