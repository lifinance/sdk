import { ChainId } from '@lifi/types'
import { describe, expect, it } from 'vitest'
import { config, setupTestServer } from './actions.unit.handlers.js'
import { getTokens } from './getTokens.js'

describe('getTokens', () => {
  setupTestServer()

  it('return the tokens', async () => {
    const result = await getTokens(config, {
      chains: [ChainId.ETH, ChainId.POL],
    })
    expect(result).toBeDefined()
    expect(result.tokens[ChainId.ETH]).toBeDefined()
  })
})
