// This file holds generator functions to create objects for testing purposes

import type { LiFiStep, Route, Token } from '@lifi/types'
import { ChainId, CoinKey } from '@lifi/types'
import type { LiFiStepExtended } from '../src/index.js'
import { findDefaultToken } from './tokens.js'

const SOME_TOKEN: Token = {
  ...findDefaultToken(CoinKey.USDC, ChainId.DAI),
  priceUSD: '',
}
const SOME_OTHER_TOKEN: Token = {
  ...findDefaultToken(CoinKey.USDT, ChainId.DAI),
  priceUSD: '',
}

export const SOME_DATE = new Date('2021-04-10').getTime()

export const buildStepObject = ({
  includingExecution = true,
}: {
  includingExecution?: boolean
}): LiFiStepExtended => ({
  id: '8d3a0474-4ee3-4a7a-90c7-2a2264b7f3a9',
  type: 'lifi',
  tool: '1inch',
  toolDetails: {
    key: '1inch',
    name: '1inch',
    logoURI:
      'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/exchanges/oneinch.png',
  },
  action: {
    fromChainId: 137,
    toChainId: 137,
    fromToken: SOME_TOKEN,
    toToken: SOME_OTHER_TOKEN,
    fromAmount: '1500000',
    slippage: 0.03,
    fromAddress: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
    toAddress: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
  },
  estimate: {
    fromAmount: '1000000',
    fromAmountUSD: '100',
    toAmount: '260982615655554',
    toAmountUSD: '26098',
    toAmountMin: '253153137185887',
    approvalAddress: '0x11111112542d85b3ef69ae05771c2dccff4faa26',
    executionDuration: 300,
    tool: '1inch',
  },
  includedSteps: [
    {
      id: 'f8474598-a553-4643-bbd1-bf8c77e679b3',
      type: 'swap',
      action: {
        fromChainId: 137,
        fromAmount: '5000000000000000000',
        fromToken: {
          address: '0x0000000000000000000000000000000000000000',
          chainId: 137,
          symbol: 'MATIC',
          decimals: 18,
          name: 'MATIC',
          priceUSD: '1.124763',
          logoURI:
            'https://static.debank.com/image/matic_token/logo_url/matic/6f5a6b6f0732a7a235131bd7804d357c.png',
          coinKey: CoinKey.MATIC,
        },
        toChainId: 137,
        toToken: {
          address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
          chainId: 137,
          symbol: 'USDT',
          decimals: 6,
          name: '(PoS) Tether USD',
          priceUSD: '1.00081',
          logoURI:
            'https://static.debank.com/image/coin/logo_url/usdt/23af7472292cb41dc39b3f1146ead0fe.png',
          coinKey: CoinKey.USDT,
        },
        slippage: 0.005,
      },
      estimate: {
        tool: '1inch',
        fromAmount: '5000000000000000000',
        toAmount: '5617317',
        toAmountMin: '5589230',
        approvalAddress: '0x1111111254eeb25477b68fb85ed929f73a960582',
        executionDuration: 30,
        feeCosts: [],
        gasCosts: [
          {
            type: 'SEND',
            price: '149725515512',
            estimate: '258059',
            limit: '344079',
            amount: '51517405651853448',
            amountUSD: '0.06',
            token: {
              address: '0x0000000000000000000000000000000000000000',
              chainId: 137,
              symbol: 'MATIC',
              decimals: 18,
              name: 'MATIC',
              priceUSD: '1.124763',
              logoURI:
                'https://static.debank.com/image/matic_token/logo_url/matic/6f5a6b6f0732a7a235131bd7804d357c.png',
              coinKey: CoinKey.MATIC,
            },
          },
        ],
      },
      tool: '1inch',
      toolDetails: {
        key: '1inch',
        name: '1inch',
        logoURI:
          'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/exchanges/oneinch.png',
      },
    },
  ],
  execution: includingExecution
    ? {
        status: 'PENDING',
        startedAt: SOME_DATE,
        doneAt: SOME_DATE,
        process: [
          {
            type: 'TOKEN_ALLOWANCE',
            startedAt: SOME_DATE,
            message: 'Somethings done',
            status: 'DONE',
            doneAt: SOME_DATE + 10,
            txHash: '0x11111112542d85b3ef69ae05771c2dccff4faa26',
            txLink: 'https://example.com',
          },
          {
            type: 'SWAP',
            startedAt: SOME_DATE + 20,
            message: 'Somethings pending',
            status: 'PENDING',
          },
        ],
        fromAmount: '1000000',
        toAmount: '261490494702370',
      }
    : undefined,
})

export const buildRouteObject = ({
  step = buildStepObject({}),
}: {
  step?: LiFiStep
}): Route => ({
  id: '0x433df53dbf6dbd7b946fc4f3b501c3ff32957d77d96c9d5ba1805b01eb6461cc',
  fromChainId: 137,
  fromAmountUSD: '1.00',
  fromAmount: '1000000',
  fromToken: SOME_TOKEN,
  fromAddress: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
  toChainId: 137,
  toAmountUSD: '1.00',
  toAmount: '260982615655554',
  toAmountMin: '253153137185887',
  toToken: SOME_OTHER_TOKEN,
  toAddress: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
  gasCostUSD: '0.01',
  steps: [step],
  insurance: {
    feeAmountUsd: '0',
    state: 'NOT_INSURABLE',
  },
})
