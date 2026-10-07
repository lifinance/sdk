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

    describe('with a signal', () => {
      it('stops in the sleep when the signal aborts, before the next attempt', async () => {
        mockedFunction.mockResolvedValue(undefined)
        const controller = new AbortController()
        const reason = new Error('stopped')

        const promise = waitForResult(
          mockedFunction,
          1000,
          3,
          undefined,
          controller.signal
        )
        const expectPromise = expect(promise).rejects.toBe(reason)
        await vi.advanceTimersByTimeAsync(1500)
        controller.abort(reason)

        await expectPromise
        await vi.advanceTimersByTimeAsync(10_000)
        expect(mockedFunction).toHaveBeenCalledTimes(2)
        expect(vi.getTimerCount()).toBe(0)
      })

      it('does not call the function when the signal has already aborted', async () => {
        const controller = new AbortController()
        controller.abort()

        await expect(
          waitForResult(mockedFunction, 1000, 3, undefined, controller.signal)
        ).rejects.toMatchObject({ name: 'AbortError' })
        expect(mockedFunction).not.toHaveBeenCalled()
      })

      it('does not sleep after a call during which the signal aborted', async () => {
        const controller = new AbortController()
        mockedFunction.mockImplementation(async () => {
          controller.abort()
          return undefined
        })

        await expect(
          waitForResult(mockedFunction, 1000, 3, undefined, controller.signal)
        ).rejects.toMatchObject({ name: 'AbortError' })
        expect(mockedFunction).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
      })

      it('gives an error of a call during which the signal aborted to no retry', async () => {
        const controller = new AbortController()
        const shouldRetry = vi.fn().mockReturnValue(true)
        mockedFunction.mockImplementation(async () => {
          controller.abort()
          throw new Error('request aborted')
        })

        await expect(
          waitForResult(mockedFunction, 1000, 3, shouldRetry, controller.signal)
        ).rejects.toMatchObject({ name: 'AbortError' })
        expect(shouldRetry).not.toHaveBeenCalled()
        expect(mockedFunction).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
      })

      it('resolves as before while the signal does not abort', async () => {
        mockedFunction
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce('success!')
        const controller = new AbortController()

        const promise = waitForResult(
          mockedFunction,
          1000,
          3,
          undefined,
          controller.signal
        )
        await vi.advanceTimersByTimeAsync(1000)

        await expect(promise).resolves.toBe('success!')
        expect(mockedFunction).toHaveBeenCalledTimes(2)
      })
    })
  })
})
