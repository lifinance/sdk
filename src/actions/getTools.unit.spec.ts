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
import { config, handlers } from './actions.unit.handlers.js'
import { getTools } from './getTools.js'

describe('getTools', () => {
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

  describe('and the backend succeeds', () => {
    it('returns the tools', async () => {
      const tools = await getTools(config, {
        chains: [ChainId.ETH, ChainId.POL],
      })

      expect(tools).toBeDefined()
      expect(tools.bridges).toBeDefined()
      expect(tools.exchanges).toBeDefined()
    })
  })
})
