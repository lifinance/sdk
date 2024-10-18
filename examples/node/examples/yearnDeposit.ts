import * as lifiDataTypes from '@lifi/data-types'
import type { ContractCallsQuoteRequest, StatusResponse } from '@lifi/sdk'
import {
  ChainId,
  CoinKey,
  EVM,
  createConfig,
  getContractCallsQuote,
  getStatus,
} from '@lifi/sdk'
import type { Address, Chain } from 'viem'
import {
  http,
  createWalletClient,
  encodeFunctionData,
  parseAbi,
  publicActions,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, mainnet, optimism, polygon } from 'viem/chains'
import 'dotenv/config'
import { promptConfirm } from '../helpers/promptConfirm'
import { checkTokenAllowance } from './utils/checkTokenAllowance'
import { transformTxRequestToSendTxParams } from './utils/transformTxRequestToSendTxParams'

const { findDefaultToken } = (lifiDataTypes as any).default

const run = async () => {
  console.info('>> Starting Yearn Demo: Deposit WETH on Polygon')
  console.info('>> Initialize LI.FI SDK')

  try {
    const privateKey = process.env.PRIVATE_KEY as Address

    // NOTE: Here we are using the private key to get the account,
    // but you can also use a Mnemonic account - see https://viem.sh/docs/accounts/mnemonic
    const account = privateKeyToAccount(privateKey)

    const client = createWalletClient({
      account,
      chain: arbitrum,
      transport: http(),
    }).extend(publicActions)

    const switchChains = [mainnet, arbitrum, optimism, polygon]

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
                  if (chain.id === chainId) {
                    return chain
                  }
                }) as Chain,
                transport: http(),
              })
            ),
        }),
      ],
    })

    const config = {
      fromChain: ChainId.ARB,
      toChain: ChainId.POL,
      fromToken: findDefaultToken(CoinKey.ETH, ChainId.ARB).address,
      amount: '100000000000000', // WETH amount
      vaultAddress: '0x305F25377d0a39091e99B975558b1bdfC3975654',
      vaultAsset: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      depositGas: '100000', // e.g. https://polygonscan.com/tx/0xcaf0322cc1ef9e1a0d9049733752f602fb50018c15c04926ea8ecf8c7b39a022
      depositContractAbi: [
        'function deposit(uint amount, address to) external',
      ],
    }

    const depositTxData = encodeFunctionData({
      abi: parseAbi(config.depositContractAbi),
      functionName: 'deposit',
      args: [config.amount, account.address],
    })

    const contractCallsQuoteRequest: ContractCallsQuoteRequest = {
      fromChain: config.fromChain,
      fromToken: config.fromToken,
      fromAddress: account.address,
      toChain: config.toChain,
      toToken: config.vaultAsset,
      toAmount: config.amount,
      contractCalls: [
        {
          fromAmount: config.amount,
          fromTokenAddress: config.vaultAsset,
          toContractAddress: config.vaultAddress,
          toContractCallData: depositTxData,
          toContractGasLimit: config.depositGas,
        },
      ],
    }
    console.info(
      '>> create contract calls quote request',
      contractCallsQuoteRequest
    )

    const contactCallsQuoteResponse = await getContractCallsQuote(
      contractCallsQuoteRequest
    )
    console.info('>> Contract Calls Quote', contactCallsQuoteResponse)

    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

    await checkTokenAllowance(contactCallsQuoteResponse, account, client)

    console.info(
      '>> Execute transaction',
      contactCallsQuoteResponse.transactionRequest
    )

    const hash = await client.sendTransaction(
      transformTxRequestToSendTxParams(
        client.account,
        contactCallsQuoteResponse.transactionRequest
      )
    )
    console.info('>> Transaction sent', hash)

    const receipt = await client.waitForTransactionReceipt({
      hash,
    })
    console.info('>> Transaction receipt', receipt)

    // wait for execution (not needed as same chain call)
    if (config.fromChain !== config.toChain) {
      let result: StatusResponse
      do {
        await new Promise((res) => {
          setTimeout(() => {
            res(null)
          }, 5000)
        })

        result = await getStatus({
          txHash: receipt.transactionHash,
          bridge: contactCallsQuoteResponse.tool,
          fromChain: contactCallsQuoteResponse.action.fromChainId,
          toChain: contactCallsQuoteResponse.action.toChainId,
        })

        console.info('>> Status update', result)
      } while (result.status !== 'DONE' && result.status !== 'FAILED')
    }

    console.info('>> DONE')
  } catch (e) {
    console.error(e)
  }
}

run()

// Sample transactions
// Same chain: https://polygonscan.com/tx/0x0d28817fcec3b56cf9f3d73b5476d4256b40cb64fd95528e52060a302b7cae3f
// Cross chain: https://explorer.li.fi/tx/0xad331b9bf4cc8c953f5227b41bfcddcfb11de6da5e0462cc20c1f4591b1a9e4e
