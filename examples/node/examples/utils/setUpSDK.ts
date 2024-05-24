import { createConfig, EVM } from '@lifi/sdk'
import type { Address, Chain } from 'viem'
import { createWalletClient, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import 'dotenv/config'

interface SetUpSDKParams {
  /**
   * initialChain: this is the chain to be used when setup up the viem client for the first time,
   */
  initialChain: Chain
  /**
   * switchChains: list of chains made available to the @lifi/sdk switchChain function and controls which chains will be available,
   */
  switchChains?: Chain[]
  /**
   * usePublicActions: some of the examples require that the wallet client have access to public client actions, when this value is true
   * the wallet client will be extended with public actions - more about this at https://viem.sh/docs/clients/wallet#optional-extend-with-public-actions
   */
  usePublicActions?: boolean
}

export const setUpSDK = ({
  initialChain,
  switchChains,
  usePublicActions = false,
}: SetUpSDKParams) => {
  const privateKey = process.env.PRIVATE_KEY as Address

  // NOTE: Here we are using the private key to get the account,
  // but you can also use a Mnemonic account - see https://viem.sh/docs/accounts/mnemonic
  const account = privateKeyToAccount(privateKey)

  let client = createWalletClient({
    account,
    chain: initialChain,
    transport: http(),
  })

  if (usePublicActions) {
    client = client.extend(publicActions)
  }

  createConfig({
    integrator: 'lifi-sdk-example',
    providers: [
      EVM({
        getWalletClient: () => Promise.resolve(client),
        ...(switchChains
          ? {
              // in some example we need to perform operations on multiple chains
              // The switch chain function below helps to facilitates this
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
            }
          : {}),
      }),
    ],
  })

  return { account, client }
}
