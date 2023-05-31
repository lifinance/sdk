import { LiFi, ChainId, CoinKey, findDefaultToken } from '@lifi/sdk'
import { RPCProvider } from '@lifi/rpc-wrapper'
import { Wallet } from 'ethers'

const lifi = new LiFi()

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
  console.log('>> Request route')
  const routeRequest = {
    fromChainId: ChainId.AVA, // Avalanche
    fromAmount: '100000', // 1 USDT
    fromTokenAddress: findDefaultToken(CoinKey.USDC, ChainId.AVA).address,
    toChainId: ChainId.AVA, // Avalanche
    toTokenAddress: findDefaultToken(CoinKey.USDT, ChainId.AVA).address,
    options: {
      slippage: 0.03, // = 3%
      allowSwitchChain: false, // execute all transaction on starting chain
      // exchanges: {
      //   allow: [], // only find direct transfers
      // },
    },
  }

  const routeResponse = await lifi.getRoutes(routeRequest)
  const route = routeResponse.routes[0]
  console.log('>> Got Route')
  console.log(route)

  // execute Route
  console.log('>> Start Execution')
  const settings = {
    updateCallback: (updatedRoute) => {
      let lastExecution
      for (const step of updatedRoute.steps) {
        if (step.execution) {
          lastExecution = step.execution
        }
      }
      console.log(lastExecution)
    },
    switchChainHook: async (requiredChainId) => {
      console.log('>>Switching Chains')
      const provider = new ethers.providers.JsonRpcProvider(
        'https://rpc.xdaichain.com/',
        requiredChainId
      )
      const wallet = ethers.Wallet.fromMnemonic(process.env.MNEMONIC).connect(
        provider
      )
      return wallet
    },
  }

  await lifi.executeRoute(wallet, route, settings)

  console.log('DONE')
}

demo()
