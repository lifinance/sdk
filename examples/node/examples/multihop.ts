import type {
  ContractCallsQuoteRequest,
  LiFiStep,
  QuoteRequest,
} from '@lifi/sdk'
import * as lifiDataTypes from '@lifi/data-types'
import {
  createConfig,
  EVM,
  CoinKey,
  ChainId,
  getQuote,
  getContractCallsQuote,
} from '@lifi/sdk'
import { promptConfirm } from '../helpers/promptConfirm'
import type { PrivateKeyAccount, Address, Chain } from 'viem'
import { createWalletClient, http, fromHex, publicActions } from 'viem'

import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { executeCrossChainQuote } from './utils/executeCrossChainQuote'
import 'dotenv/config'

const dataTypes = (lifiDataTypes as any).default
interface GetMultihopQuoteParams {
  fromChain: ChainId
  fromToken: string
  toChain: ChainId
  toToken: string
  amount: string
  address: string
}

const getMultihopQuote = async ({
  fromChain,
  fromToken,
  toChain,
  toToken,
  amount,
  address,
}: GetMultihopQuoteParams): Promise<LiFiStep> => {
  // Get bridge route from polygon to destination chain
  const secondBridgeQuoteRequest: QuoteRequest = {
    fromChain: ChainId.POL, // polygon
    fromToken: dataTypes.findDefaultToken(CoinKey.USDC, ChainId.POL).address, // USDC on polygon
    fromAmount: amount,
    toChain,
    toToken,
    fromAddress: address, // will actually be a relayer
    allowBridges: ['hop', 'stargate', 'across', 'amarok'],
    maxPriceImpact: 0.4,
  }

  console.info(
    '>> created second bridge quote request',
    secondBridgeQuoteRequest
  )

  const secondBridgeQuote = await getQuote(secondBridgeQuoteRequest)
  console.info('>> got second quote', secondBridgeQuote)

  // quote
  const quoteRequest: ContractCallsQuoteRequest = {
    fromChain,
    fromToken,
    fromAddress: address,
    toChain: secondBridgeQuote.action.fromChainId,
    toToken: secondBridgeQuote.action.fromToken.address,
    toAmount: secondBridgeQuote.action.fromAmount,
    contractCalls: [
      {
        fromAmount: secondBridgeQuote.action.fromAmount,
        fromTokenAddress: secondBridgeQuote.action.fromToken.address,
        toContractAddress: secondBridgeQuote.transactionRequest!.to!,
        toContractCallData:
          secondBridgeQuote.transactionRequest!.data!.toString(),
        toContractGasLimit: fromHex(
          secondBridgeQuote.transactionRequest!.gasLimit!.toString() as Address,
          'bigint'
        ).toString(),
      },
    ],
  }

  console.info('>> get contract calls quote', quoteRequest)

  return getContractCallsQuote(quoteRequest)
}

// TODO: look at code reuse when all examples finished
const setUpSDK = (account: PrivateKeyAccount) => {
  const client = createWalletClient({
    account,
    chain: mainnet,
    transport: http(),
  }).extend(publicActions)

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

  return client
}

const run = async () => {
  console.info('>> Starting Multihop demo - route USDC.ARB to USDC.OPT')

  try {
    const privateKey = process.env.PRIVATE_KEY as Address

    // NOTE: Here we are using the private key to get the account,
    // but you can also use a Mnemonic account - see https://viem.sh/docs/accounts/mnemonic
    const account = privateKeyToAccount(privateKey)

    console.info('>> Initialize LiFi SDK')
    const client = setUpSDK(account)

    // TODO: question: is there a clearer way to declare the start, intermediate and destination chain?
    const quoteConfig = {
      fromChain: ChainId.ARB,
      fromToken: dataTypes.findDefaultToken(CoinKey.USDC, ChainId.ARB).address, // USDC on avalanche
      toChain: ChainId.OPT,
      toToken: dataTypes.findDefaultToken(CoinKey.USDC, ChainId.OPT).address,
      amount: '100000', // 1 usd
      address: account.address,
    }

    // get quote
    const multiHopQuote = await getMultihopQuote(quoteConfig)
    console.info('>> got multihop quote', multiHopQuote)

    // continue?
    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

    // execute quote
    await executeCrossChainQuote(client, account.address, multiHopQuote)
  } catch (e) {
    console.error(e)
  }
}

run()
