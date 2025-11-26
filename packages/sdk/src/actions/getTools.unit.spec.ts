import { ChainId } from '@lifi/types'
import { describe, expect, it } from 'vitest'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getTools } from './getTools.js'

describe('getTools', () => {
  setupTestServer()

  describe('and the backend succeeds', () => {
    it('returns the tools', async () => {
      const tools = await getTools(client, {
        chains: [ChainId.ETH, ChainId.POL],
      })

      expect(tools).toBeDefined()
      expect(tools.bridges).toBeDefined()
      expect(tools.exchanges).toBeDefined()
    })
  })
})
