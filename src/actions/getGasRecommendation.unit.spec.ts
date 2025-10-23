import { ChainId } from '@lifi/types'
import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import * as request from '../request.js'
import { config, setupTestServer } from './actions.unit.handlers.js'
import { getGasRecommendation } from './getGasRecommendation.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getGasRecommendation', () => {
  setupTestServer()

  describe('user input is invalid', () => {
    it('throw an error', async () => {
      await expect(
        getGasRecommendation(config, {
          chainId: undefined as unknown as number,
        })
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError('Required parameter "chainId" is missing.')
        )
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })
  })

  describe('user input is valid', () => {
    describe('and the backend call is successful', () => {
      it('call the server once', async () => {
        await getGasRecommendation(config, {
          chainId: ChainId.OPT,
        })

        expect(mockedFetch).toHaveBeenCalledTimes(1)
      })
    })
  })
})
