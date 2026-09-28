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

    it.each([0, false, ''])(
      'returns the falsy result %j without polling again',
      async (value) => {
        mockedFunction.mockResolvedValueOnce(value)

        await expect(waitForResult(mockedFunction, 1000)).resolves.toBe(value)
        expect(mockedFunction).toHaveBeenCalledTimes(1)
      }
    )

    it('polls again while the function resolves with null', async () => {
      mockedFunction
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('success!')

      const promise = waitForResult(mockedFunction, 1000)
      await vi.advanceTimersByTimeAsync(1000)

      await expect(promise).resolves.toBe('success!')
      expect(mockedFunction).toHaveBeenCalledTimes(2)
    })

    it('throws on the first error when maxRetries is 0', async () => {
      mockedFunction.mockImplementation(() => Promise.reject('some error'))

      const promise = waitForResult(mockedFunction, 1000, 0)
      const expectPromise = expect(promise).rejects.toBe('some error')
      await vi.advanceTimersByTimeAsync(5000)

      await expectPromise
      expect(mockedFunction).toHaveBeenCalledTimes(1)
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
