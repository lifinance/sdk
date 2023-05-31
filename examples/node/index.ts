import {
  ChainId,
  CoinKey,
  ConfigUpdate,
  Execution,
  ExecutionSettings,
  findDefaultToken,
  LiFi,
  Route,
} from '@lifi/sdk'
import { RPCProvider } from '@lifi/rpc-wrapper'
import { providers, Signer, Wallet } from 'ethers'
import 'dotenv/config'

console.log('>> Starting Demo')

const mnemonic = process.env.MNEMONIC || ''

async function demo() {
  // setup wallet
  if (!process.env.MNEMONIC) {
    console.warn(
      'Please specify a MNEMONIC phrase in your environment variables: `export MNEMONIC="..."`'
    )
    return
  }
  console.log('>> Setup Wallet')

  const myRpcProviders = [
    {
      chainId: 43114,
      url: 'https://open-platform.nodereal.io/959d0cc48937455d937a1a52ef1d503f/avalanche-c/ext/bc/C/rpc',
    },
    {
      chainId: 43114,
      url: 'https://avax-mainnet.gateway.pokt.network/v1/lb/6303a5e60295e8003b5bce00',
    },
  ]

  const provider = new RPCProvider(myRpcProviders)

  const wallet = Wallet.fromMnemonic(mnemonic).connect(provider)

  // get Route
  console.log('>> Configuring route')
  const routeRequest = {
    fromChainId: ChainId.AVA, // Avalanche
    fromAmount: '100000', // 1 USDT
    fromTokenAddress: findDefaultToken(CoinKey.USDC, ChainId.AVA).address,
    toChainId: ChainId.AVA, // Avalanche
    toTokenAddress: findDefaultToken(CoinKey.USDT, ChainId.AVA).address,
    options: {
      slippage: 0.03, // = 3%
      allowSwitchChain: false, // execute all transaction on starting chain
    },
  }

  // STEP 1: Initialize the API

  // ☝️ This configuration is totally optional! ------------------------------------
  const optionalConfigs: ConfigUpdate = {
    integrator: 'lifi-sdk-node-example', // DEFAULT 'lifi-sdk'
    apiUrl: 'https://li.quest/v1', // DEFAULT production endpoint
    defaultExecutionSettings: {
      // You can provide default execution settings @see {ExecutionSettings}
      updateRouteHook: (route: Route): void => {
        return console.log('>> Route updated', route)
      },
      switchChainHook: (
        requiredChainId: number
      ): Promise<Signer | undefined> => {
        console.log('>> Switching to chain', requiredChainId)
        return Promise.resolve(wallet)
      },
      infiniteApproval: false, // DEFAULT false
    },
  }
  // ---------------------------------------------------------------------------

  console.log('>> Initialize LiFi')

  const lifi = new LiFi(optionalConfigs)

  console.log('>> Initialized, Requesting route')

  console.log(JSON.stringify(routeRequest, null, 4))

  // STEP 2: Request a route
  const routeResponse = await lifi.getRoutes(routeRequest)
  const route = routeResponse.routes[0]
  console.log('>> Got Route')

  // STEP 3: Execute the route
  console.log('>> Start Execution')

  // These are optonal settings for execution ------------------------------------
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

  console.log({ route })

  await lifi.executeRoute(wallet, route, settings)

  console.log('>> Done')
}

demo()
