import { findDefaultToken } from '@lifi/data-types'
import type { RoutesResponse } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { RoutesRequest } from '../types/actions.js'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getRoutes } from './getRoutes.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getRoutes', () => {
  setupTestServer()

  const getRoutesRequest = ({
    fromChainId = ChainId.BSC,
    fromAmount = '10000000000000',
    fromTokenAddress = findDefaultToken(CoinKey.USDC, ChainId.BSC).address,
    toChainId = ChainId.DAI,
    toTokenAddress = findDefaultToken(CoinKey.USDC, ChainId.DAI).address,
    options = { slippage: 0.03 },
  }: {
    fromChainId?: ChainId
    fromAmount?: string
    fromTokenAddress?: string
    toChainId?: ChainId
    toTokenAddress?: string
    options?: { slippage: number }
  }): RoutesRequest => ({
    fromChainId,
    fromAmount,
    fromTokenAddress,
    toChainId,
    toTokenAddress,
    options,
  })

  describe('user input is invalid', () => {
    it('should throw Error because of invalid fromChainId type', async () => {
      const request = getRoutesRequest({
        fromChainId: 'xxx' as unknown as ChainId,
      })

      await expect(getRoutes(client, request)).rejects.toThrow(
        'Invalid routes request.'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })

    it('should throw Error because of invalid fromAmount type', async () => {
      const request = getRoutesRequest({
        fromAmount: 10000000000000 as unknown as string,
      })

      await expect(getRoutes(client, request)).rejects.toThrow(
        'Invalid routes request.'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })

    it('should throw Error because of invalid fromTokenAddress type', async () => {
      const request = getRoutesRequest({
        fromTokenAddress: 1234 as unknown as string,
      })

      await expect(getRoutes(client, request)).rejects.toThrow(
        'Invalid routes request.'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })

    it('should throw Error because of invalid toChainId type', async () => {
      const request = getRoutesRequest({
        toChainId: 'xxx' as unknown as ChainId,
      })

      await expect(getRoutes(client, request)).rejects.toThrow(
        'Invalid routes request.'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })

    it('should throw Error because of invalid toTokenAddress type', async () => {
      const request = getRoutesRequest({ toTokenAddress: '' })

      await expect(getRoutes(client, request)).rejects.toThrow(
        'Invalid routes request.'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })

    it('should throw Error because of invalid options type', async () => {
      const request = getRoutesRequest({
        options: { slippage: 'not a number' as unknown as number },
      })

      await expect(getRoutes(client, request)).rejects.toThrow(
        'Invalid routes request.'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })
  })

  describe('user input is valid', () => {
    describe('and the backend call is successful', () => {
      it('call the server once', async () => {
        const request = getRoutesRequest({})
        await getRoutes(client, request)
        expect(mockedFetch).toHaveBeenCalledTimes(1)
      })
    })
  })

  // A host and a widget can share one SDK client (see
  // `WidgetConfig.sdkClient`). The client then carries the HOST's integrator,
  // referrer and fee, so every caller that needs its own must send them with
  // the request. These lock that precedence: params win over client config.
  describe('attribution precedence', () => {
    it('prefers the integrator on the request over the client config', async () => {
      const request = getRoutesRequest({})
      request.options = {
        ...request.options,
        integrator: 'caller-own-integrator',
      } as RoutesRequest['options']

      await getRoutes(client, request)

      expect(request.options?.integrator).toBe('caller-own-integrator')
      expect(request.options?.integrator).not.toBe(client.config.integrator)
    })

    it('falls back to the client integrator only when the request omits one', async () => {
      const request = getRoutesRequest({})

      await getRoutes(client, request)

      expect(request.options?.integrator).toBe(client.config.integrator)
    })

    it('keeps the referrer and fee the request carries', async () => {
      const request = getRoutesRequest({})
      request.options = {
        ...request.options,
        referrer: '0xcaller-referrer',
        fee: 0.0025,
      } as RoutesRequest['options']

      await getRoutes(client, request)

      expect(request.options?.referrer).toBe('0xcaller-referrer')
      expect(request.options?.fee).toBe(0.0025)
    })
  })

  describe('with optional limit-order fields', () => {
    const orderRequest: RoutesRequest = {
      ...getRoutesRequest({}),
      toAmount: '5000000000000',
      validUntil: 1750000000,
      partiallyFillable: true,
    }

    it('calls the server once', async () => {
      await getRoutes(client, orderRequest)
      expect(mockedFetch).toHaveBeenCalledTimes(1)
    })

    it('resolves to the routes response shape', () => {
      expectTypeOf(getRoutes(client, orderRequest)).toEqualTypeOf<
        Promise<RoutesResponse>
      >()
    })
  })
})
