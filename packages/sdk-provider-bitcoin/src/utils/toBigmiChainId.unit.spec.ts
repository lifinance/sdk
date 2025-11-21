import { ChainId } from '@lifi/sdk'
import { describe, expect, it } from 'vitest'
import { toBigmiChainId } from './toBigmiChainId.js'

describe('toBigmiChainId', () => {
  it('should convert BTC ChainId to BITCOIN_MAINNET', () => {
    const bigmiChainId = toBigmiChainId(ChainId.BTC)
    expect(bigmiChainId).toBe('bitcoin:mainnet')
  })

  it('should throw error for unsupported chainId', () => {
    expect(() => {
      toBigmiChainId(1 as ChainId)
    }).toThrow('Unsupported chainId mapping: 1')
  })
})
