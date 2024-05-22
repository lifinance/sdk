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
import type { PrivateKeyAccount, Address, Chain } from 'viem'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import 'dotenv/config'

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

// TODO: look at code reuse when all example finshed
const setUpSDK = (account: PrivateKeyAccount) => {
  const client = createWalletClient({
    account,
    chain: optimism as Chain,
    transport: http(),
  })

  // We need to perform operations on multiple chains
  // The switch chain function below facilitates this
  const chains = [mainnet, arbitrum, optimism, polygon]

  createConfig({
    integrator: 'lifi-sdk-example',
    providers: [
      EVM({
        getWalletClient: () => Promise.resolve(client),
        switchChain: (chainId) =>
          Promise.resolve(
            createWalletClient({
              account,
              chain: chains.find((chain) => {
                if (chain.id == chainId) {
                  return chain
                }
              }) as Chain,
              transport: http(),
            })
          ),
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

  console.info('>> Got Route')

  if (!(await promptConfirm('Execute Route?'))) {
    return
  }

  console.info('>> Start Execution')

  // TODO: clean up
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

console.info('>> Starting Bridge Demo')

run()
