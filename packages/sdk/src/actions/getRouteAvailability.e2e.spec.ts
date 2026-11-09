import { findDefaultToken } from '@lifi/data-types'
import { ChainId, CoinKey } from '@lifi/types'
import { describe, expect, it } from 'vitest'
import { LiFiErrorCode } from '../errors/constants.js'
import { client } from './actions.unit.handlers.js'
import { getRouteAvailability } from './getRouteAvailability.js'

describe('getRouteAvailability live', () => {
  it('classifies a current ETH to Base route as ROUTABLE', async () => {
    const result = await getRouteAvailability(client, {
      fromChainId: ChainId.ETH,
      fromAmount: '10000000000000000',
      fromTokenAddress: findDefaultToken(CoinKey.ETH, ChainId.ETH).address,
      toChainId: ChainId.BAS,
      toTokenAddress: findDefaultToken(CoinKey.ETH, ChainId.BAS).address,
      options: { slippage: 0.03 },
    })

    expect(result.status).toBe('ROUTABLE')
    if (result.status !== 'ROUTABLE') {
      throw new Error('unreachable')
    }
    expect(result.response.routes.length).toBeGreaterThan(0)
  }, 100000)

  it('classifies an invalid token as UNKNOWN', async () => {
    const result = await getRouteAvailability(client, {
      fromChainId: ChainId.ETH,
      fromAmount: '1',
      fromTokenAddress: '0x0000000000000000000000000000000000000001',
      toChainId: ChainId.BAS,
      toTokenAddress: findDefaultToken(CoinKey.ETH, ChainId.BAS).address,
      options: { slippage: 0.03 },
    })

    expect(result.status).toBe('UNKNOWN')
    if (result.status !== 'UNKNOWN') {
      throw new Error('unreachable')
    }
    expect(result.cause.code).toBe(LiFiErrorCode.ValidationError)
  }, 100000)
})
