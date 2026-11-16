import { ChainId } from '@lifi/types'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { BaseError } from '../errors/baseError.js'
import { ErrorName, LiFiErrorCode } from '../errors/constants.js'
import { SDKError } from '../errors/SDKError.js'
import type { QuoteRequestFromAmount } from '../types/actions.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getRelayerQuote } from './getRelayerQuote.js'

describe('getRelayerQuote', () => {
  const server = setupTestServer()

  const request: QuoteRequestFromAmount = {
    fromChain: ChainId.ETH,
    fromToken: '0xA0b86a33E6441c8C06DDD4f36e4C4C5B4c3B4c3B',
    fromAddress: '0x1234567890123456789012345678901234567890',
    fromAmount: '1000000',
    toChain: ChainId.POL,
    toToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  }

  /** Answers the legacy endpoint with a quote and counts the requests it gets. */
  const answerRelayerQuote = (): { count: number } => {
    const requests = { count: 0 }
    server.use(
      http.get(`${client.config.apiUrl}/relayer/quote`, () => {
        requests.count++
        return HttpResponse.json({ status: 'ok', data: { id: 'step' } })
      })
    )
    return requests
  }

  it('rejects with a not-found error and sends no request', async () => {
    const requests = answerRelayerQuote()

    const error = await getRelayerQuote(client, request).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(SDKError)
    const cause = (error as SDKError).cause
    expect(cause).toBeInstanceOf(BaseError)
    expect(cause.name).toBe(ErrorName.NotFoundError)
    expect(cause.code).toBe(LiFiErrorCode.NotFound)
    expect(requests.count).toBe(0)
  })

  // Published widgets call it as `getRelayerQuote(...).catch(() => null)`. A
  // synchronous throw would skip that catch and fail their routes query.
  it('returns a rejected promise instead of throwing synchronously', async () => {
    answerRelayerQuote()
    let quote: Promise<unknown> | undefined

    expect(() => {
      quote = getRelayerQuote(client, {} as QuoteRequestFromAmount)
    }).not.toThrow()

    await expect(quote).rejects.toBeInstanceOf(SDKError)
  })
})
