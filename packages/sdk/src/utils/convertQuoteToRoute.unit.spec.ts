import { describe, expect, it } from 'vitest'
import { SDKError } from '../errors/SDKError.js'
import { convertQuoteToRoute } from './convertQuoteToRoute.js'

describe('convertQuoteToRoute', () => {
  const validQuote = {
    id: 'test-quote',
    type: 'swap',
    tool: 'test-tool',
    action: {
      fromToken: { address: '0x111', decimals: 18, chainId: 1 },
      fromAmount: '1000000000000000000',
      fromAddress: '0xaaa',
      toToken: { address: '0x222', decimals: 18, chainId: 1 },
      toAddress: '0xbbb',
    },
    estimate: {
      fromAmount: '1000000000000000000',
      toAmount: '2000000000000000000',
      toAmountMin: '1900000000000000000',
      fromAmountUSD: '100',
      toAmountUSD: '200',
      approvalAddress: '0x333',
    },
  }

  it('should convert valid quote to route', () => {
    const route = convertQuoteToRoute(validQuote as any)

    expect(route.id).toBe('test-quote')
    expect(route.fromChainId).toBe(1)
    expect(route.toChainId).toBe(1)
    expect(route.fromAmount).toBe('1000000000000000000')
    expect(route.toAmount).toBe('2000000000000000000')
    expect(route.fromAmountUSD).toBe('100')
    expect(route.toAmountUSD).toBe('200')
  })

  it('should throw error when fromAmountUSD is missing', () => {
    const invalidQuote = {
      ...validQuote,
      estimate: { ...validQuote.estimate, fromAmountUSD: undefined },
    }

    expect(() => convertQuoteToRoute(invalidQuote as any)).toThrow(SDKError)
  })

  it('should throw error when toAmountUSD is missing', () => {
    const invalidQuote = {
      ...validQuote,
      estimate: { ...validQuote.estimate, toAmountUSD: undefined },
    }

    expect(() => convertQuoteToRoute(invalidQuote as any)).toThrow(SDKError)
  })
})
