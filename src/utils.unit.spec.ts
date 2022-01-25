import { repeatUntilDone } from './utils/utils'

describe('utils', () => {
  describe('repeatUntilDone', () => {
    let mockedFunction: jest.Mock

    beforeEach(() => {
      mockedFunction = jest.fn()
    })

    it('should throw an error if repeat function fails', async () => {
      mockedFunction.mockRejectedValue(new Error('some error'))

      await expect(repeatUntilDone(mockedFunction)).rejects.toThrow(
        'some error'
      )
    })

    it('should try until repeat function succeeds', async () => {
      mockedFunction
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce('success!')

      const result = await repeatUntilDone(mockedFunction, 10)
      expect(result).toEqual('success!')
    })
  })
})
