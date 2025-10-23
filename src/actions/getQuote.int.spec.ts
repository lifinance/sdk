import { describe, expect, it } from 'vitest'
import { config } from './actions.unit.handlers.js'
import { getQuote } from './getQuote.js'

describe('ApiService Integration Tests', () => {
  it('should successfully request a quote', async () => {
    const quote = await getQuote(config, {
      fromChain: '1',
      fromToken: '0x0000000000000000000000000000000000000000',
      fromAddress: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
      fromAmount: '1000000000000000000',
      toChain: '137',
      toToken: '0x0000000000000000000000000000000000000000',
      // allowBridges: ['hop', 'multichain'],
    })
    expect(quote).toBeDefined()
  }, 100000)
})
