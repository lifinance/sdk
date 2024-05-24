import * as lifiDataTypes from '@lifi/data-types'
import type {
  ContractCallsQuoteRequest,
  LiFiStep,
  QuoteRequest,
} from '@lifi/sdk'
import { CoinKey, ChainId, getQuote, getContractCallsQuote } from '@lifi/sdk'
import type { Address, Chain } from 'viem'
import { fromHex } from 'viem'
import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import { promptConfirm } from '../helpers/promptConfirm'
import { executeCrossChainQuote } from './utils/executeCrossChainQuote'
import { setUpSDK } from './utils/setUpSDK'
import type { WalletClientWithPublicActions } from './types'

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

const run = async () => {
  console.info('>> Starting Multihop demo - route USDC.ARB to USDC.OPT')

  try {
    console.info('>> Initialize LiFi SDK')
    const { client, account } = setUpSDK({
      initialChain: arbitrum,
      switchChains: [mainnet, arbitrum, optimism, polygon] as Chain[],
      usePublicActions: true,
    })

    // TODO: question: is there a clearer way to declare the start, intermediate and destination chain?
    const quoteConfig = {
      fromChain: ChainId.ARB,
      fromToken: dataTypes.findDefaultToken(CoinKey.USDC, ChainId.ARB).address, // USDC on arbitrum
      toChain: ChainId.OPT,
      toToken: dataTypes.findDefaultToken(CoinKey.USDC, ChainId.OPT).address,
      amount: '100000', // 1 usd
      address: account.address,
    }

    const multiHopQuote = await getMultihopQuote(quoteConfig)
    console.info('>> got multihop quote', multiHopQuote)

    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

    await executeCrossChainQuote(
      client as WalletClientWithPublicActions,
      account.address,
      multiHopQuote
    )
  } catch (e) {
    console.error(e)
  }
}

run()
