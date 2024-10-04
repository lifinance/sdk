import * as lifiDataTypes from '@lifi/data-types'
import {
  ChainId,
  CoinKey,
  EVM,
  createConfig,
  executeRoute,
  getRoutes,
} from '@lifi/sdk'
import type { Address, Chain } from 'viem'
import { http, createWalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { optimism } from 'viem/chains'
import { promptConfirm } from '../helpers/promptConfirm'
import 'dotenv/config'
import { reportStepsExecutionToTerminal } from '../helpers/reportStepsExecutionToTerminal'

const dataTypes = (lifiDataTypes as any).default

async function run() {
  console.info('>> Starting Swap Demo')

  const privateKey = process.env.PRIVATE_KEY as Address

  // NOTE: Here we are using the private key to get the account,
  // but you can also use a Mnemonic account - see https://viem.sh/docs/accounts/mnemonic
  const account = privateKeyToAccount(privateKey)

  console.info('>> Initialize LiFi SDK')

  const client = createWalletClient({
    account,
    chain: optimism as Chain,
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

  const routeRequest = {
    toAddress: account.address,
    fromAddress: account.address,
    fromChainId: ChainId.OPT, // Optimisim
    fromAmount: '100000', // USDT
    fromTokenAddress: dataTypes.findDefaultToken(CoinKey.USDC, ChainId.OPT)
      .address,
    toChainId: ChainId.OPT, // Optimisim
    toTokenAddress: dataTypes.findDefaultToken(CoinKey.USDT, ChainId.OPT)
      .address,
    options: {
      slippage: 0.03, // = 3%
      allowSwitchChain: false, // execute all transaction on starting chain
    },
  }
  console.info('>> Requesting route', routeRequest)

  const routeResponse = await getRoutes(routeRequest)
  const route = routeResponse.routes[0]

  console.info('>> Got Route', route)

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
