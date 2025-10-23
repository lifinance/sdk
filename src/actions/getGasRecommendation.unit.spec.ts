import { ChainId } from '@lifi/types'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import * as request from '../request.js'
import { requestSettings } from '../request.js'
import { config, handlers } from './actions.unit.handlers.js'
import { getGasRecommendation } from './getGasRecommendation.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getGasRecommendation', () => {
  const server = setupServer(...handlers)

  beforeAll(() => {
    server.listen({
      onUnhandledRequest: 'warn',
    })
    requestSettings.retries = 0
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => server.resetHandlers())

  afterAll(() => {
    requestSettings.retries = 1
    server.close()
  })

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
