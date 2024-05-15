import * as lifiDataTypes from '@lifi/data-types'
import {
  createConfig,
  EVM,
  executeRoute,
  getRoutes,
  ChainId,
  CoinKey,
  Execution,
} from '@lifi/sdk'
import { promptConfirm } from '../helpers/promptConfirm'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import 'dotenv/config'

const dataTypes = (lifiDataTypes as any).default

console.info('>> Starting Demo')
const getRequestRoute = () => ({
  fromChainId: ChainId.ETH, // Ethereum
  fromAmount: '100000', // 1 USDT
  fromTokenAddress: dataTypes.findDefaultToken(CoinKey.USDC, ChainId.ETH)
    .address,
  toChainId: ChainId.ETH, // Ethereum
  toTokenAddress: dataTypes.findDefaultToken(CoinKey.USDT, ChainId.ETH).address,
  options: {
    slippage: 0.03, // = 3%
    allowSwitchChain: false, // execute all transaction on starting chain
  },
})
const setUpSDK = () => {
  const privateKey = process.env.PRIVATE_KEY

  const account = privateKeyToAccount(privateKey as `0x${string}`)

  const client = createWalletClient({
    account,
    chain: mainnet,
    transport: http(),
  })

  createConfig({
    integrator: 'lifi-sdk-example',
    providers: [
      EVM({
        getWalletClient: () => Promise.resolve(client),
      }),
    ],
  })
}
async function run() {
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

  const executionOptions = {
    updateRouteHook: (updatedRoute) => {
      let lastExecution: Execution | undefined = undefined
      for (const step of updatedRoute.steps) {
        if (step.execution) {
          lastExecution = step.execution
        }
      }
      console.log(lastExecution)
    },
  }
  await executeRoute(route, executionOptions)

  console.info('>> Done')
}

run()
