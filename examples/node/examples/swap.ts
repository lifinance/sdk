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
import type { PrivateKeyAccount, Address } from 'viem'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import 'dotenv/config'

const dataTypes = (lifiDataTypes as any).default

console.info('>> Starting Demo')

// NOTE: we add the wallet address to the route request.
// This means that any route responses will feature that address for
// use in route execution.
// In the example below we are exchanging USDC and USDT tokens on Ethereum
const getRequestRoute = ({ address }: PrivateKeyAccount) => ({
  toAddress: address,
  fromAddress: address,
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
const setUpSDK = (account: PrivateKeyAccount) => {
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
  const privateKey = process.env.PRIVATE_KEY as Address

  // NOTE: Here we are using the private key to get the account,
  // but you can also use a Mnemonic account - see https://viem.sh/docs/accounts/mnemonic
  const account = privateKeyToAccount(privateKey)

  console.info('>> Initialize LiFi SDK')
  setUpSDK(account)

  console.info('>> Initialized, Requesting route')
  const routeRequest = getRequestRoute(account)

  const routeResponse = await getRoutes(routeRequest)
  const route = routeResponse.routes[0]

  console.info('>> Got Route', JSON.stringify(route, null, 2))

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
