import Lifi, {
  ChainId,
  CoinKey,
  ConfigUpdate,
  Execution,
  ExecutionSettings,
  findDefaultToken,
  Route,
} from '@lifi/sdk'
import { providers, Signer, Wallet } from 'ethers'

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
  const provider = new providers.JsonRpcProvider(
    'https://polygon-rpc.com/',
    137
  )
  const wallet = Wallet.fromMnemonic(mnemonic).connect(provider)

  // get Route
  console.log('>> Request route')
  const routeRequest = {
    fromChainId: ChainId.POL, // Polygon
    fromAmount: '1000000', // 1 USDT
    fromTokenAddress: findDefaultToken(CoinKey.USDT, ChainId.POL).address,
    toChainId: ChainId.DAI, // xDai
    toTokenAddress: findDefaultToken(CoinKey.USDT, ChainId.DAI).address,
    options: {
      slippage: 0.03, // = 3%
      allowSwitchChain: false, // execute all transaction on starting chain
      exchanges: {
        allow: [], // only find direct transfers
      },
    },
  }

  // STEP 1: Initialize the API

  // ☝️ This configuration is totally optional! ------------------------------------
  const optionalConfigs: ConfigUpdate = {
    apiUrl: 'https://li.quest', // DEFAULT production endpoint
    rpcs: {
      // You can provide custom RPCs
      137: ['https://polygon-rpc.com/'],
    },
    multicallAddresses: {
      // You can provide custom addresses for multicall
      137: '0x02817C1e3543c2d908a590F5dB6bc97f933dB4BD',
    },
    defaultExecutionSettings: {
      // You can provide default execution settings @see {ExecutionSettings}
      updateCallback: (route: Route): void => {
        console.log('>> Route updated', route)
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

  const api = new Lifi(optionalConfigs)

  // STEP 2: Request a route
  const routeResponse = await api.getRoutes(routeRequest)
  const route = routeResponse.routes[0]
  console.log('>> Got Route')
  console.log(route)

  // STEP 3: Execute the route
  console.log('>> Start Execution')

  // These are optonal settings for execution ------------------------------------
  const settings: ExecutionSettings = {
    updateCallback: (updatedRoute) => {
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

  await api.executeRoute(wallet, route, settings)

  console.log('>> Done')
}

demo()
