import * as lifiDataTypes from '@lifi/data-types'
import {
  executeRoute,
  getRoutes,
  ChainId,
  CoinKey,
  createConfig,
  EVM,
} from '@lifi/sdk'
import type { Address, Chain } from 'viem'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import 'dotenv/config'
import { promptConfirm } from '../helpers/promptConfirm'
import { reportStepsExecutionToTerminal } from '../helpers/reportStepsExecutionToTerminal'

const { findDefaultToken } = (lifiDataTypes as any).default

async function run() {
  console.info('>> Starting Bridge Demo')
  console.info('>> Initialize LiFi SDK')

  const privateKey = process.env.PRIVATE_KEY as Address

  // NOTE: Here we are using the private key to get the account,
  // but you can also use a Mnemonic account - see https://viem.sh/docs/accounts/mnemonic
  const account = privateKeyToAccount(privateKey)

  const client = createWalletClient({
    account,
    chain: optimism as Chain,
    transport: http(),
  })

  const switchChains = [mainnet, arbitrum, optimism, polygon] as Chain[]

  createConfig({
    integrator: 'lifi-sdk-example',
    providers: [
      EVM({
        getWalletClient: () => Promise.resolve(client),
        switchChain: (chainId) =>
          Promise.resolve(
            createWalletClient({
              account,
              chain: switchChains.find((chain) => {
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

  console.info('>> Initialized, Requesting route')

  const routeRequest = {
    toAddress: account.address,
    fromAddress: account.address,
    fromChainId: ChainId.OPT, // Optimism
    fromAmount: '1000000', // 1 USDC
    fromTokenAddress: findDefaultToken(CoinKey.USDC, ChainId.OPT).address,
    toChainId: ChainId.ARB, // Arbitrum
    toTokenAddress: findDefaultToken(CoinKey.USDC, ChainId.ARB).address,
    options: {
      slippage: 0.03, // = 3%
    },
  }
  const routeResponse = await getRoutes(routeRequest)
  const route = routeResponse.routes[0]

  console.info('>> Got Route')

  if (!(await promptConfirm('Execute Route?'))) {
    return
  }

  console.info('>> Start Execution')

  // here we are using the update route hook to report the execution steps to the terminal
  const executionOptions = {
    updateRouteHook: reportStepsExecutionToTerminal,
  }
  await executeRoute(route, executionOptions)

  console.info('>> Done')
}

run()
