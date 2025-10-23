import { findDefaultToken } from '@lifi/data-types'
import type { WalletTokenExtended } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from './actions.unit.handlers.js'
import { getWalletBalances } from './getWalletBalances.js'

const mockedGetWalletBalances = vi.spyOn(
  await import('./getWalletBalances.js'),
  'getWalletBalances'
)

describe('getWalletBalances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const SOME_TOKEN = {
    ...findDefaultToken(CoinKey.USDC, ChainId.DAI),
    priceUSD: '',
  }
  const SOME_WALLET_ADDRESS = 'some wallet address'

  describe('user input is invalid', () => {
    it('should throw Error because of missing walletAddress', async () => {
      await expect(getWalletBalances(config, '')).rejects.toThrow(
        'Missing walletAddress.'
      )
    })
  })

  describe('user input is valid', () => {
    it('should call the balance service without options', async () => {
      const balanceResponse: Record<number, WalletTokenExtended[]> = {
        [ChainId.DAI]: [
          {
            ...SOME_TOKEN,
            amount: '123',
            marketCapUSD: 1000000,
            volumeUSD24H: 50000,
            fdvUSD: 2000000,
          },
        ],
      }

      mockedGetWalletBalances.mockReturnValue(Promise.resolve(balanceResponse))

      const result = await getWalletBalances(config, SOME_WALLET_ADDRESS)

      expect(mockedGetWalletBalances).toHaveBeenCalledTimes(1)
      expect(mockedGetWalletBalances).toHaveBeenCalledWith(
        config,
        SOME_WALLET_ADDRESS
      )
      expect(result).toEqual(balanceResponse)
    })

    it('should call the balance service with options', async () => {
      const balanceResponse: Record<number, WalletTokenExtended[]> = {
        [ChainId.DAI]: [
          {
            ...SOME_TOKEN,
            amount: '123',
            marketCapUSD: 1000000,
            volumeUSD24H: 50000,
            fdvUSD: 2000000,
          },
        ],
      }

      const options = { signal: new AbortController().signal }

      mockedGetWalletBalances.mockReturnValue(Promise.resolve(balanceResponse))

      const result = await getWalletBalances(
        config,
        SOME_WALLET_ADDRESS,
        options
      )

      expect(mockedGetWalletBalances).toHaveBeenCalledTimes(1)
      expect(mockedGetWalletBalances).toHaveBeenCalledWith(
        config,
        SOME_WALLET_ADDRESS,
        options
      )
      expect(result).toEqual(balanceResponse)
    })
  })
})
