import { ChainId, CoinKey, findDefaultToken, Token } from '@lifi/types'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  buildRouteObject,
  buildStepObject,
  mockChainsResponse,
  mockStatus,
  mockStepTransactionWithTxRequest,
} from '../test/fixtures'
import * as balance from './balance'
import { convertQuoteToRoute } from './helpers'
import { LiFi } from './LiFi'
import { Signer } from 'ethers'
import ConfigService from './services/ConfigService'

import { requestSettings } from './request'

import { rest } from 'msw'
import { setupServer } from 'msw/node'

const step = buildStepObject({
  includingExecution: true,
})

vi.mock('./balance', () => ({
  getTokenBalancesForChains: vi.fn(() => Promise.resolve([])),
  getTokenBalance: vi.fn(() => Promise.resolve([])),
  getTokenBalances: vi.fn(() => Promise.resolve([])),
  checkBalance: vi.fn(() => Promise.resolve([])),
}))

vi.mock('./execution/switchChain', () => ({
  switchChain: vi.fn(() => Promise.resolve(signer)),
}))

vi.mock('./allowance/utils', () => ({
  getApproved: vi.fn(() => Promise.resolve([])),
}))

const mockedGetTokenBalance = vi.spyOn(balance, 'getTokenBalance')
const mockedGetTokenBalances = vi.spyOn(balance, 'getTokenBalances')
const mockedGetTokenBalancesForChains = vi.spyOn(
  balance,
  'getTokenBalancesForChains'
)

let signer: Signer

let lifi: LiFi

describe('LIFI SDK', () => {
  const config = ConfigService.getInstance().getConfig()

  const server = setupServer(
    rest.post(
      `${config.apiUrl}/advanced/stepTransaction`,
      async (_, response, context) =>
        response(
          context.status(200),
          context.json(mockStepTransactionWithTxRequest(step))
        )
    ),
    rest.get(`${config.apiUrl}/chains`, async (_, response, context) =>
      response(
        context.status(200),
        context.json({
          chains: mockChainsResponse,
        })
      )
    ),
    rest.get(`${config.apiUrl}/status`, async (_, response, context) =>
      response(context.status(200), context.json(mockStatus))
    )
  )

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

  beforeEach(() => {
    requestSettings.retries = 0
    vi.clearAllMocks()
    lifi = new LiFi()

    signer = {
      estimateGas: vi.fn(() => Promise.resolve(100000)),
      sendTransaction: vi.fn().mockResolvedValue({
        hash: '0xabc',
        wait: () => Promise.resolve({ hash: '0xabc' }),
      }),
    } as unknown as Signer
  })

  afterEach(() => server.resetHandlers())
  afterAll(() => {
    server.close()
  })

  describe('getTokenBalance', () => {
    const SOME_TOKEN = findDefaultToken(CoinKey.USDC, ChainId.DAI)
    const SOME_WALLET_ADDRESS = 'some wallet address'

    describe('user input is invalid', () => {
      it('should throw Error because of missing walletAddress', async () => {
        await expect(lifi.getTokenBalance('', SOME_TOKEN)).rejects.toThrow(
          'Missing walletAddress.'
        )

        expect(mockedGetTokenBalance).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of invalid token', async () => {
        await expect(
          lifi.getTokenBalance(SOME_WALLET_ADDRESS, {
            address: 'some wrong stuff',
            chainId: 'not a chain Id',
          } as unknown as Token)
        ).rejects.toThrow(
          'Invalid token passed: address "some wrong stuff" on chainId "not a chain Id"'
        )

        expect(mockedGetTokenBalance).toHaveBeenCalledTimes(0)
      })
    })

    describe('user input is valid', () => {
      it('should call the balance service', async () => {
        const balanceResponse = {
          ...SOME_TOKEN,
          amount: '123',
          blockNumber: 1,
        }

        mockedGetTokenBalance.mockReturnValue(Promise.resolve(balanceResponse))

        const result = await lifi.getTokenBalance(
          SOME_WALLET_ADDRESS,
          SOME_TOKEN
        )

        expect(mockedGetTokenBalance).toHaveBeenCalledTimes(1)
        expect(result).toEqual(balanceResponse)
      })
    })
  })

  describe('getTokenBalances', () => {
    const SOME_TOKEN = findDefaultToken(CoinKey.USDC, ChainId.DAI)
    const SOME_WALLET_ADDRESS = 'some wallet address'

    describe('user input is invalid', () => {
      it('should throw Error because of missing walletAddress', async () => {
        await expect(lifi.getTokenBalances('', [SOME_TOKEN])).rejects.toThrow(
          'Missing walletAddress.'
        )

        expect(mockedGetTokenBalances).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of an invalid token', async () => {
        await expect(
          lifi.getTokenBalances(SOME_WALLET_ADDRESS, [
            SOME_TOKEN,
            { not: 'a token' } as unknown as Token,
          ])
        ).rejects.toThrow(
          'Invalid token passed: address "undefined" on chainId "undefined"'
        )

        expect(mockedGetTokenBalances).toHaveBeenCalledTimes(0)
      })

      it('should return empty token list as it is', async () => {
        mockedGetTokenBalances.mockReturnValue(Promise.resolve([]))
        const result = await lifi.getTokenBalances(SOME_WALLET_ADDRESS, [])
        expect(result).toEqual([])
        expect(mockedGetTokenBalances).toHaveBeenCalledTimes(1)
      })
    })

    describe('user input is valid', () => {
      it('should call the balance service', async () => {
        const balanceResponse = [
          {
            ...SOME_TOKEN,
            amount: '123',
            blockNumber: 1,
          },
        ]

        mockedGetTokenBalances.mockReturnValue(Promise.resolve(balanceResponse))

        const result = await lifi.getTokenBalances(SOME_WALLET_ADDRESS, [
          SOME_TOKEN,
        ])

        expect(mockedGetTokenBalances).toHaveBeenCalledTimes(1)
        expect(result).toEqual(balanceResponse)
      })
    })
  })

  describe('getTokenBalancesForChains', () => {
    const SOME_TOKEN = findDefaultToken(CoinKey.USDC, ChainId.DAI)
    const SOME_WALLET_ADDRESS = 'some wallet address'

    describe('user input is invalid', () => {
      it('should throw Error because of missing walletAddress', async () => {
        await expect(
          lifi.getTokenBalancesForChains('', { [ChainId.DAI]: [SOME_TOKEN] })
        ).rejects.toThrow('Missing walletAddress.')

        expect(mockedGetTokenBalancesForChains).toHaveBeenCalledTimes(0)
      })

      it('should throw Error because of an invalid token', async () => {
        await expect(
          lifi.getTokenBalancesForChains(SOME_WALLET_ADDRESS, {
            [ChainId.DAI]: [{ not: 'a token' } as unknown as Token],
          })
        ).rejects.toThrow(
          'Invalid token passed: address "undefined" on chainId "undefined"'
        )

        expect(mockedGetTokenBalancesForChains).toHaveBeenCalledTimes(0)
      })

      it('should return empty token list as it is', async () => {
        mockedGetTokenBalancesForChains.mockReturnValue(Promise.resolve([]))

        const result = await lifi.getTokenBalancesForChains(
          SOME_WALLET_ADDRESS,
          {
            [ChainId.DAI]: [],
          }
        )

        expect(result).toEqual([])
        expect(mockedGetTokenBalancesForChains).toHaveBeenCalledTimes(1)
      })
    })

    describe('user input is valid', () => {
      it('should call the balance service', async () => {
        const balanceResponse = {
          [ChainId.DAI]: [
            {
              ...SOME_TOKEN,
              amount: '123',
              blockNumber: 1,
            },
          ],
        }

        mockedGetTokenBalancesForChains.mockReturnValue(
          Promise.resolve(balanceResponse)
        )

        const result = await lifi.getTokenBalancesForChains(
          SOME_WALLET_ADDRESS,
          {
            [ChainId.DAI]: [SOME_TOKEN],
          }
        )

        expect(mockedGetTokenBalancesForChains).toHaveBeenCalledTimes(1)
        expect(result).toEqual(balanceResponse)
      })
    })
  })

  describe('Should convert Step to Route', () => {
    it('should convert Step to Route', () => {
      const mockStep = buildStepObject({
        includingExecution: true,
      })

      const convertedRoute = convertQuoteToRoute(mockStep)

      expect(convertedRoute.fromAmountUSD).toEqual(
        mockStep.estimate.fromAmountUSD
      )
    })
  })

  describe('Should pick up gas from signer estimation', () => {
    it('should pick up gas estimation from signer', async () => {
      const route = buildRouteObject({
        step,
      })

      await lifi.executeRoute(signer, route)

      expect(signer.sendTransaction).toHaveBeenCalledWith({
        gasLimit: '125000',
        // TODO: Check the cause for gasLimit being outside transactionRequest. Currently working as expected in widget
        transactionRequest: {
          chainId: 137,
          data: '0xdata',
          from: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
          gasLimit: '682701',
          gasPrice: '0x27c01c1727',
          to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
          value: '0x0600830dbc7f5bf7',
        },
      })
    })
  })
})
