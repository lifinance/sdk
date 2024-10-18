import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForResult } from './waitForResult.js'

describe('utils', () => {
  describe('waitForResult', () => {
    let mockedFunction: any

    beforeEach(() => {
      mockedFunction = vi.fn()
    })
    //.mockImplementation(() => Promise.reject(new Error('some error')))

    it('should throw an error if repeat function fails', async () => {
      mockedFunction.mockRejectedValue(new Error('some error'))

      await expect(waitForResult(mockedFunction)).rejects.toThrow('some error')
    })

    it('should try until repeat function succeeds', async () => {
      mockedFunction
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce('success!')

      const result = await waitForResult(mockedFunction, 10)
      expect(result).toEqual('success!')
    })
  })
})
