import { describe, expect, it } from 'vitest'
import { toQueryString } from './toQueryString.js'

describe('toQueryString', () => {
  it('encodes scalar params (string, number, boolean)', () => {
    expect(
      toQueryString({
        fromChain: 137,
        fromToken: 'USDC',
        allowDestinationCall: true,
      })
    ).toEqual('fromChain=137&fromToken=USDC&allowDestinationCall=true')
  })

  it('encodes scalar values', () => {
    expect(toQueryString({ fromAddress: 'a b' })).toEqual('fromAddress=a%20b')
  })

  it('encodes bigint scalars', () => {
    expect(toQueryString({ fromAmount: 1000000000n })).toEqual(
      'fromAmount=1000000000'
    )
  })

  it('comma-joins scalar arrays (backend qs.parse({ comma: true }) splits them)', () => {
    expect(
      toQueryString({ allowBridges: ['connext', 'uniswap', 'polygon'] })
    ).toEqual('allowBridges=connext%2Cuniswap%2Cpolygon')
  })

  it('encodes arrays of objects in qs indices notation', () => {
    expect(
      toQueryString({
        distributionFees: [
          { percentage: 0.0005, receiver: '0xTenantA' },
          { percentage: 0.001, receiver: '0xTenantB' },
        ],
      })
    ).toEqual(
      'distributionFees[0][percentage]=0.0005&distributionFees[0][receiver]=0xTenantA&distributionFees[1][percentage]=0.001&distributionFees[1][receiver]=0xTenantB'
    )
  })

  it('skips undefined and null entries', () => {
    expect(
      toQueryString({
        fromChain: 137,
        toChain: undefined,
        fromToken: null,
        toToken: 'USDC',
      })
    ).toEqual('fromChain=137&toToken=USDC')
  })

  it('returns an empty string for an empty object', () => {
    expect(toQueryString({})).toEqual('')
  })
})
