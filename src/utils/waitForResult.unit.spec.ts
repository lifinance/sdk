import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForResult } from './waitForResult.js'

describe('utils', () => {
  describe('waitForResult', () => {
    let mockedFunction: any

    beforeEach(() => {
      mockedFunction = vi.fn()
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should throw immediately if shouldRetry returns false', async () => {
      mockedFunction.mockImplementation(() => Promise.reject('some error'))
      const shouldRetry = vi.fn().mockReturnValue(false)

      const promise = waitForResult(mockedFunction, 1000, 3, shouldRetry)

      await expect(promise).rejects.toThrowError('some error')
      expect(mockedFunction).toHaveBeenCalledTimes(1)
      expect(shouldRetry).toHaveBeenCalledWith(0, 'some error')
    })

    it('should try until repeat function succeeds', async () => {
      mockedFunction
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce('success!')

      const promise = waitForResult(mockedFunction, 1000)

      // Fast-forward through retries
      for (let i = 0; i < 2; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }

      const result = await promise
      expect(result).toEqual('success!')
      expect(mockedFunction).toHaveBeenCalledTimes(3)
    })

    it('should respect the interval between retries', async () => {
      mockedFunction
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce('success!')

      const promise = waitForResult(mockedFunction, 2000)

      await vi.advanceTimersByTimeAsync(2000)
      const result = await promise

      expect(result).toEqual('success!')
      expect(mockedFunction).toHaveBeenCalledTimes(2)
    })

    it('should throw an error if repeat function fails and maxRetries is reached', async () => {
      mockedFunction.mockImplementation(() => Promise.reject('some error'))
      const maxRetries = 2

      const promise = waitForResult(mockedFunction, 1000, maxRetries)
      const expectPromise = expect(promise).rejects.toThrowError('some error')
      // Fast-forward through retries
      for (let i = 0; i < maxRetries - 1; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }

      await expectPromise
      expect(mockedFunction).toHaveBeenCalledTimes(maxRetries)
    })
  })
})
