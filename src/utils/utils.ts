import { AddressZero, AlternativeAddressZero } from '../constants.js'

export const wait = (ms: number): Promise<undefined> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Repeatedly calls a given asynchronous function until it resolves with a value
 * @param toRepeat The function that should be repeated
 * @param timeout The timeout in milliseconds between retries, defaults to 5000
 * @returns The result of the toRepeat function
 */
export const repeatUntilDone = async <T>(
  toRepeat: () => Promise<T | undefined>,
  timeout = 5000
): Promise<T> => {
  let result: T | undefined

  while (!result) {
    result = await toRepeat()
    if (!result) {
      await wait(timeout)
    }
  }

  return result
}

export const isZeroAddress = (address: string): boolean => {
  if (address === AddressZero || address === AlternativeAddressZero) {
    return true
  }
  return false
}

export const isNativeTokenAddress = (address: string): boolean => {
  if (
    address === AddressZero ||
    address === AlternativeAddressZero ||
    // CELO native token
    address === '0x471ece3750da237f93b8e339c536989b8978a438'
  ) {
    return true
  }
  return false
}
