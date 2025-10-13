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
import * as request from '../request.js'
import { requestSettings } from '../request.js'
import { config, handlers } from './api.unit.handlers.js'
import { getChains } from './getChains.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getChains', () => {
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

  describe('and the backend call is successful', () => {
    it('call the server once', async () => {
      const chains = await getChains(config)

      expect(chains[0]?.id).toEqual(1)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
    })
  })
})
