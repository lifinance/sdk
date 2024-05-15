import * as lifiDataTypes from '@lifi/data-types'
import type { SDKProvider } from '@lifi/sdk'
import {
  config,
  EVM,
  executeRoute,
  getRoutes,
  ChainId,
  CoinKey,
  Solana,
} from '@lifi/sdk'
import { getWalletClient, switchChain, http, createConfig } from '@wagmi/core'
import { mainnet, avalanche } from '@wagmi/core/chains'
import { promptConfirm } from './helpers/promptConfirm'

const dataTypes = (lifiDataTypes as any).default

console.info('>> Starting Demo')
const getRequestRoute = () => ({
  fromChainId: ChainId.AVA, // Avalanche
  fromAmount: '100000', // 1 USDT
  fromTokenAddress: dataTypes.findDefaultToken(CoinKey.USDC, ChainId.AVA)
    .address,
  toChainId: ChainId.AVA, // Avalanche
  toTokenAddress: dataTypes.findDefaultToken(CoinKey.USDT, ChainId.AVA).address,
  options: {
    slippage: 0.03, // = 3%
    allowSwitchChain: false, // execute all transaction on starting chain
  },
})
const setUpSDK = () => {
  const providers: SDKProvider[] = []

  const wagmiConfig = createConfig({
    chains: [mainnet, avalanche],
    transports: {
      [mainnet.id]: http(),
      [avalanche.id]: http(),
    },
  })

  providers.push(
    EVM({
      getWalletClient: () => getWalletClient(wagmiConfig),
      switchChain: async (chainId) => {
        console.info('>>Switching Chains')
        const chain = await switchChain(wagmiConfig, { chainId })
        return getWalletClient(wagmiConfig, { chainId: chain.id })
      },
    })
  )

  // TODO: question: I don't think this is needed to get this example to run
  //  but should we have a solana example too at somepoint?
  // TODO: if it is needed then need to figure out how to get the wallet
  // providers.push(
  //   Solana({
  //     async getWalletAdapter() {
  //       return wallet?.adapter as WalletAdapter
  //     },
  //   })
  // )

  config.setProviders(providers)
}
async function run() {
  //TODO: figure out what I need to do to replace the getSigner code form swap.ts

  console.info('>> Initialize LiFi SDK')
  setUpSDK()

  console.info('>> Initialized, Requesting route')
  const routeRequest = getRequestRoute()

  const routeResponse = await getRoutes(routeRequest)
  const route = routeResponse.routes[0]

  console.info('>> Got Route')

  if (!(await promptConfirm('Execute Route?'))) {
    return
  }

  console.info('>> Start Execution')

  //TODO: understand what parameters I need to pass to the executeRoute command
  // await executeRoute(route, {});

  console.info('>> Done')
}

run()
