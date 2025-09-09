import type { LiFiStep } from '@lifi/types'
import { buildStepObject } from '../../tests/fixtures.js'

export const mockChainsResponse = [
  {
    key: 'pol',
    chainType: 'EVM',
    name: 'Polygon',
    coin: 'MATIC',
    id: 137,
    mainnet: true,
    logoURI:
      'https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/chains/polygon.svg',
    tokenlistUrl:
      'https://unpkg.com/quickswap-default-token-list@1.0.71/build/quickswap-default.tokenlist.json',
    faucetUrls: ['https://stakely.io/faucet/polygon-matic'],
    multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11',
    metamask: {
      chainId: '0x89',
      blockExplorerUrls: [
        'https://polygonscan.com/',
        'https://explorer-mainnet.maticvigil.com/',
      ],
      chainName: 'Matic(Polygon) Mainnet',
      nativeCurrency: {
        name: 'MATIC',
        symbol: 'MATIC',
        decimals: 18,
      },
      rpcUrls: [
        'https://polygon-rpc.com/',
        'https://rpc-mainnet.maticvigil.com/',
      ],
    },
    nativeToken: {
      address: '0x0000000000000000000000000000000000000000',
      chainId: 137,
      symbol: 'MATIC',
      decimals: 18,
      name: 'MATIC',
      priceUSD: '0.899628',
      logoURI:
        'https://static.debank.com/image/matic_token/logo_url/matic/6f5a6b6f0732a7a235131bd7804d357c.png',
      coinKey: 'MATIC',
    },
  },
]

const mockTransactionRequest = {
  transactionRequest: {
    data: '0xdata',
    to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE',
    value: '0x0600830dbc7f5bf7',
    from: '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0',
    chainId: 137,
    gasPrice: '0x27c01c1727',
    gasLimit: '682701',
  },
}

export const mockStatus = {
  status: 'DONE',
  receiving: true,
  sending: {
    amount: '123',
    gasAmount: '123',
    gasAmountUSD: '123',
    gasPrice: '123',
    gasToken: '123',
    gasUsed: '123',
  },
}

export const mockStepTransactionWithTxRequest = (
  step: LiFiStep = buildStepObject({
    includingExecution: false,
  })
) => ({
  ...step,
  transactionRequest: mockTransactionRequest,
})
