import { ChainId } from '@lifi/types'
import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../errors/errors.js'
import { SDKError } from '../errors/SDKError.js'
import * as request from '../utils/request.js'
import { client, setupTestServer } from './actions.unit.handlers.js'
import { getQuote } from './getQuote.js'

const mockedFetch = vi.spyOn(request, 'request')

describe('getQuote', () => {
  setupTestServer()

  const fromChain = ChainId.DAI
  const fromToken = 'DAI'
  const fromAddress = 'Some wallet address'
  const fromAmount = '1000'
  const toChain = ChainId.POL
  const toToken = 'MATIC'
  const toAmount = '1000'

  describe('user input is invalid', () => {
    it('throw an error', async () => {
      await expect(
        getQuote(client, {
          fromChain: undefined as unknown as ChainId,
          fromToken,
          fromAddress,
          fromAmount,
          toChain,
          toToken,
        })
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError('Required parameter "fromChain" is missing.')
        )
      )

      await expect(
        getQuote(client, {
          fromChain,
          fromToken: undefined as unknown as string,
          fromAddress,
          fromAmount,
          toChain,
          toToken,
        })
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError('Required parameter "fromToken" is missing.')
        )
      )

      await expect(
        getQuote(client, {
          fromChain,
          fromToken,
          fromAddress: undefined as unknown as string,
          fromAmount,
          toChain,
          toToken,
        })
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError('Required parameter "fromAddress" is missing.')
        )
      )

      await expect(
        getQuote(client, {
          fromChain,
          fromToken,
          fromAddress,
          fromAmount: undefined as unknown as string,
          toChain,
          toToken,
        })
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError(
            'Required parameter "fromAmount" or "toAmount" is missing.'
          )
        )
      )

      await expect(
        getQuote(client, {
          fromChain,
          fromToken,
          fromAddress,
          fromAmount,
          toChain,
          toToken,
          toAmount,
        } as any)
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError(
            'Cannot provide both "fromAmount" and "toAmount" parameters.'
          )
        )
      )

      await expect(
        getQuote(client, {
          fromChain,
          fromToken,
          fromAddress,
          fromAmount,
          toChain: undefined as unknown as ChainId,
          toToken,
        })
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError('Required parameter "toChain" is missing.')
        )
      )

      await expect(
        getQuote(client, {
          fromChain,
          fromToken,
          fromAddress,
          fromAmount,
          toChain,
          toToken: undefined as unknown as string,
        })
      ).rejects.toThrowError(
        new SDKError(
          new ValidationError('Required parameter "toToken" is missing.')
        )
      )

      expect(mockedFetch).toHaveBeenCalledTimes(0)
    })
  })

  describe('user input is valid', () => {
    describe('and the backend call is successful', () => {
      it('call the server once', async () => {
        await getQuote(client, {
          fromChain,
          fromToken,
          fromAddress,
          fromAmount,
          toChain,
          toToken,
        })

        expect(mockedFetch).toHaveBeenCalledTimes(1)
      })
    })

    describe('and distributionFees are provided', () => {
      const distributionFees = [
        { percentage: 0.0005, receiver: '0xTenantA' },
        { percentage: 0.001, receiver: '0xTenantB' },
      ]

      it('serializes distributionFees as qs indices notation on /quote', async () => {
        await getQuote(client, {
          fromChain,
          fromToken,
          fromAddress,
          fromAmount,
          toChain,
          toToken,
          distributionFees,
        })

        const url = mockedFetch.mock.calls[0][1] as string
        expect(url.startsWith(`${client.config.apiUrl}/quote?`)).toBe(true)
        // Scalar params still serialize as before
        expect(url).toContain(`fromChain=${fromChain}`)
        expect(url).toContain(`fromAmount=${fromAmount}`)
        // Array-of-objects param is expressed in bracket-indices notation
        expect(url).toContain(
          'distributionFees[0][percentage]=0.0005&distributionFees[0][receiver]=0xTenantA&distributionFees[1][percentage]=0.001&distributionFees[1][receiver]=0xTenantB'
        )
        // and is NOT the broken [object Object] form
        expect(url).not.toContain('object+Object')
      })

      it('serializes distributionFees on the /quote/toAmount path', async () => {
        await getQuote(client, {
          fromChain,
          fromToken,
          fromAddress,
          toChain,
          toToken,
          toAmount,
          distributionFees,
        })

        const url = mockedFetch.mock.calls[0][1] as string
        expect(url.startsWith(`${client.config.apiUrl}/quote/toAmount?`)).toBe(
          true
        )
        expect(url).toContain(
          'distributionFees[0][percentage]=0.0005&distributionFees[0][receiver]=0xTenantA'
        )
      })
    })
  })
})
