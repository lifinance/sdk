import * as lifiDataTypes from '@lifi/data-types'
import type { Execution, ExecutionSettings, Route, SDKOptions } from '@lifi/sdk'
import { ChainId, CoinKey } from '@lifi/sdk'
import 'dotenv/config'
import { Wallet, providers } from 'ethers'
import { getLifi, getSigner, promptConfirm } from './helpers'

console.log('>> Starting Demo')

const dataTypes = (lifiDataTypes as any).default

const mnemonic = process.env.MNEMONIC || ''

async function demo() {
  // get Route
  const routeRequest = {
    fromChainId: ChainId.AVA, // Avalanche
    fromAmount: '100000', // 1 USDT
    fromTokenAddress: dataTypes.findDefaultToken(CoinKey.USDC, ChainId.AVA)
      .address,
    toChainId: ChainId.AVA, // Avalanche
    toTokenAddress: dataTypes.findDefaultToken(CoinKey.USDT, ChainId.AVA)
      .address,
    options: {
      slippage: 0.03, // = 3%
      allowSwitchChain: false, // execute all transaction on starting chain
    },
  }

  // STEP 1: Initialize the API

  // ☝️ This configuration is totally optional! ------------------------------------
  const optionalConfigs: SDKOptions = {
    integrator: 'lifi-sdk-node-example', // DEFAULT 'lifi-sdk'
    apiUrl: 'https://li.quest/v1', // DEFAULT production endpoint
    defaultExecutionSettings: {
      // You can provide default execution settings @see {ExecutionSettings}
      updateRouteHook: (route: Route): void => {
        return console.log('>> Route updated', route)
      },
      infiniteApproval: false, // DEFAULT false
    },
  }
  // ---------------------------------------------------------------------------

  console.log('>> Initialize LiFi')

  const lifi = getLifi(optionalConfigs)

  console.log('>> Initialized, Requesting route')

  console.log(JSON.stringify(routeRequest, null, 4))

  // STEP 2: Request a route
  const routeResponse = await lifi.getRoutes(routeRequest)
  const route = routeResponse.routes[0]
  console.log('>> Got Route')

  // STEP 3: Execute the route
  console.log('>> Start Execution')

  // These are optonal settings for execution ------------------------------------
  const wallet = await getSigner(ChainId.AVA)

  const settings: ExecutionSettings = {
    updateRouteHook: (updatedRoute) => {
      let lastExecution: Execution | undefined = undefined
      for (const step of updatedRoute.steps) {
        if (step.execution) {
          lastExecution = step.execution
        }
      }
      console.log(lastExecution)
    },
    switchChainHook: async (requiredChainId: number) => {
      console.log('>>Switching Chains')
      const provider = new providers.JsonRpcProvider(
        'https://rpc.xdaichain.com/',
        requiredChainId
      )
      const wallet = Wallet.fromMnemonic(mnemonic).connect(provider)
      return wallet
    },
  }
  // ---------------------------------------------------------------------------

  if (!(await promptConfirm('Execute Route?'))) {
    return
  }

  await lifi.executeRoute(wallet, route, settings)

  console.log('>> Done')
}

demo()
