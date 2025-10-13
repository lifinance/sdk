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
import { requestSettings } from '../request.js'
import { config, handlers } from './api.unit.handlers.js'
import { getTokens } from './getTokens.js'

describe('getTokens', () => {
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

  it('return the tokens', async () => {
    const result = await getTokens(config, {
      chains: [ChainId.ETH, ChainId.POL],
    })
    expect(result).toBeDefined()
    expect(result.tokens[ChainId.ETH]).toBeDefined()
  })
})
