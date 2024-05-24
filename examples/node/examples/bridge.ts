import * as lifiDataTypes from '@lifi/data-types'
import { executeRoute, getRoutes, ChainId, CoinKey, Execution } from '@lifi/sdk'
import { promptConfirm } from '../helpers/promptConfirm'
import type { PrivateKeyAccount, Chain } from 'viem'
import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import { setUpSDK } from './utils/setUpSDK'

const dataTypes = (lifiDataTypes as any).default

// NOTE: we add the wallet address to the route request.
// This means that any route responses will feature that address for
// use in route execution.
// In the example below we are bridging - exchanging USDC on Optimism and USDT tokens on Arbitrum
const getRequestRoute = ({ address }: PrivateKeyAccount) => ({
  toAddress: address,
  fromAddress: address,
  fromChainId: ChainId.OPT, // Optimism
  fromAmount: '100000', // 1 USDT
  fromTokenAddress: dataTypes.findDefaultToken(CoinKey.USDC, ChainId.OPT)
    .address,
  toChainId: ChainId.ARB, // Arbitrum
  toTokenAddress: dataTypes.findDefaultToken(CoinKey.USDT, ChainId.ARB).address,
  options: {
    slippage: 0.03, // = 3%
  },
})

async function run() {
  console.info('>> Starting Bridge Demo')
  console.info('>> Initialize LiFi SDK')

  const { account } = setUpSDK({
    initialChain: optimism as Chain,
    switchChains: [mainnet, arbitrum, optimism, polygon] as Chain[],
  })

  console.info('>> Initialized, Requesting route')

  const routeRequest = getRequestRoute(account)
  const routeResponse = await getRoutes(routeRequest)
  const route = routeResponse.routes[0]

  console.info('>> Got Route')

  if (!(await promptConfirm('Execute Route?'))) {
    return
  }

  console.info('>> Start Execution')

  // here we are using the update route hook to report the execution steps to the terminal
  const executionOptions = {
    updateRouteHook: (updatedRoute) => {
      const lastExecution = updatedRoute.steps.reduce((accum, step) => {
        if (step.execution) {
          return step.execution
        }
      }, undefined)
      console.log(lastExecution)
    },
  }
  await executeRoute(route, executionOptions)

  console.info('>> Done')
}

run()
