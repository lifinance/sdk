import { ChainId } from '@lifi/types'
import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getToken } from './getToken.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getToken', () => {
  setupTestServer()

  describe('user input is invalid', () => {
    it('throw an error', async () => {
      await expect(
        getToken(client, undefined as unknown as ChainId, 'DAI')
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError('Required parameter "chain" is missing.')
        )
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)

      await expect(
        getToken(client, ChainId.ETH, undefined as unknown as string)
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError('Required parameter "token" is missing.')
        )
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })
  })

  describe('user input is valid', () => {
    describe('and the backend call is successful', () => {
      it('call the server once', async () => {
        await getToken(client, ChainId.DAI, 'DAI')

        expect(mockedFetch).toHaveBeenCalledTimes(1)
      })
    })
  })
})
