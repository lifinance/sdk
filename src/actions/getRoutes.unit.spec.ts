import { findDefaultToken } from '@lifi/data-types'
import type { RoutesRequest } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { describe, expect, it, vi } from 'vitest'
import * as request from '../request.js'
import { config, setupTestServer } from './actions.unit.handlers.js'
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

      await expect(getRoutes(config, request)).rejects.toThrow(
        'Invalid routes request.'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })

    it('should throw Error because of invalid fromAmount type', async () => {
      const request = getRoutesRequest({
        fromAmount: 10000000000000 as unknown as string,
      })

      await expect(getRoutes(config, request)).rejects.toThrow(
        'Invalid routes request.'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })

    it('should throw Error because of invalid fromTokenAddress type', async () => {
      const request = getRoutesRequest({
        fromTokenAddress: 1234 as unknown as string,
      })

      await expect(getRoutes(config, request)).rejects.toThrow(
        'Invalid routes request.'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })

    it('should throw Error because of invalid toChainId type', async () => {
      const request = getRoutesRequest({
        toChainId: 'xxx' as unknown as ChainId,
      })

      await expect(getRoutes(config, request)).rejects.toThrow(
        'Invalid routes request.'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })

    it('should throw Error because of invalid toTokenAddress type', async () => {
      const request = getRoutesRequest({ toTokenAddress: '' })

      await expect(getRoutes(config, request)).rejects.toThrow(
        'Invalid routes request.'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })

    it('should throw Error because of invalid options type', async () => {
      const request = getRoutesRequest({
        options: { slippage: 'not a number' as unknown as number },
      })

      await expect(getRoutes(config, request)).rejects.toThrow(
        'Invalid routes request.'
      )
      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })
  })

  describe('user input is valid', () => {
    describe('and the backend call is successful', () => {
      it('call the server once', async () => {
        const request = getRoutesRequest({})
        await getRoutes(config, request)
        expect(mockedFetch).toHaveBeenCalledTimes(1)
      })
    })
  })
})
