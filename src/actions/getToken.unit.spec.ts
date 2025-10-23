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
import { getToken } from './getToken.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getToken', () => {
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
        getToken(config, undefined as unknown as ChainId, 'DAI')
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError('Required parameter "chain" is missing.')
        )
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)

      await expect(
        getToken(config, ChainId.ETH, undefined as unknown as string)
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
        await getToken(config, ChainId.DAI, 'DAI')

        expect(mockedFetch).toHaveBeenCalledTimes(1)
      })
    })
  })
})
