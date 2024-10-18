import { sleep } from './sleep.js'

/**
 * Repeatedly calls a given asynchronous function until it resolves with a value
 * @param fn The function that should be repeated
 * @param interval The timeout in milliseconds between retries, defaults to 5000
 * @returns The result of the fn function
 */
export const waitForResult = async <T>(
  fn: () => Promise<T | undefined>,
  interval = 5000
): Promise<T> => {
  let result: T | undefined
  while (!result) {
    result = await fn()
    if (!result) {
      await sleep(interval)
    }
  }
  return result
}
