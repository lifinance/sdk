import * as lifiDataTypes from '@lifi/data-types'
import type { ContractCallsQuoteRequest, LiFiStep } from '@lifi/sdk'
import { ChainId, CoinKey, getContractCallsQuote } from '@lifi/sdk'
import type { Chain } from 'viem'
import {
  parseAbi,
  encodeFunctionData,
  parseUnits,
  createPublicClient,
  http,
} from 'viem'
import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import { promptConfirm } from '../helpers/promptConfirm'
import { executeCrossChainQuote } from './utils/executeCrossChainQuote'
import { setUpSDK } from './utils/setUpSDK'
import { WalletClientWithPublicActions } from './types'

const dataTypes = (lifiDataTypes as any).default

const USDCe_POL = dataTypes.findDefaultToken(CoinKey.USDCe, ChainId.POL)

const Base_Carbon_Tonne_POL = '0x2F800Db0fdb5223b3C3f354886d907A671414A7F'

// https://docs.klimadao.finance/developers/contracts/retirement/v2-diamond/generalized-retirement
const KLIMA_ETHEREUM_CONTRACT_POL = '0x8cE54d9625371fb2a068986d32C85De8E6e995f8'
const KLIMA_ABI = [
  'function getSourceAmountDefaultRetirement(address,address,uint256) external view returns (uint256 amountIn)',
  'function retireExactCarbonDefault(address, address, uint256, uint256, string, address, string, string, uint8)',
]
const KLIMA_GAS_LIMIT = '1300000'

const getKlimaQuote = async (
  fromChain: ChainId,
  fromToken: string,
  client: WalletClientWithPublicActions,
  userAddress: string,
  retireAmount: string
): Promise<LiFiStep> => {
  const abi = parseAbi(KLIMA_ABI)

  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(),
  })

  const sourceAmountDefaultRetirement = await publicClient.readContract({
    address: KLIMA_ETHEREUM_CONTRACT_POL,
    abi,
    functionName: 'getSourceAmountDefaultRetirement',
    args: [
      USDCe_POL.address, // address sourceToken,
      Base_Carbon_Tonne_POL, // address poolToken,
      retireAmount, // uint256 retireAmount,
    ],
  })

  const usdcAmount = parseUnits(
    sourceAmountDefaultRetirement.toString(),
    USDCe_POL.decimals
  ).toString()

  console.log('>> usdcAmount', usdcAmount)

  const retireTxData = encodeFunctionData({
    abi,
    functionName: 'retireExactCarbonDefault',
    args: [
      USDCe_POL.address, // address sourceToken,
      Base_Carbon_Tonne_POL, // address poolToken,
      usdcAmount, // uint256 maxAmountIn,
      retireAmount, // uint256 retireAmount,
      'LI.FI', // string memory retiringEntityString,
      '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0', // address beneficiaryAddress,
      'LI.FI', // string memory beneficiaryString,
      'Cross Chain Contract Calls', // string memory retirementMessage,
      0, // LibTransfer.From fromMode],
    ],
  })

  // quote
  const quoteRequest: ContractCallsQuoteRequest = {
    fromChain,
    fromToken,
    fromAddress: userAddress,
    toChain: ChainId.POL,
    toToken: USDCe_POL.address,
    toAmount: usdcAmount,
    contractCalls: [
      {
        fromAmount: usdcAmount,
        fromTokenAddress: USDCe_POL.address,
        toContractAddress: KLIMA_ETHEREUM_CONTRACT_POL,
        toContractCallData: retireTxData,
        toContractGasLimit: KLIMA_GAS_LIMIT,
      },
    ],
  }

  console.info('>> create ContractCallsQuoteRequest', quoteRequest)

  return getContractCallsQuote(quoteRequest)
}

const run = async () => {
  console.info('>> Klima Retire Demo: Retire(burn) Carbon tokens to offset CO2')
  console.info('>> Initialize LiFi SDK')

  const { client, account } = setUpSDK({
    initialChain: optimism as Chain,
    switchChains: [mainnet, arbitrum, optimism, polygon] as Chain[],
    usePublicActions: true,
  })

  // config
  const fromChain = ChainId.OPT
  const fromToken = dataTypes.findDefaultToken(
    CoinKey.USDC,
    ChainId.OPT
  ).address
  const retireAmount = '100000' // 1 USDC

  try {
    // get quote
    const quote = await getKlimaQuote(
      fromChain,
      fromToken,
      client as WalletClientWithPublicActions,
      account.address,
      retireAmount
    )
    console.info('>> Quote received', quote)

    // continue?
    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

    // execute quote
    await executeCrossChainQuote(
      client as WalletClientWithPublicActions,
      account.address,
      quote
    )
  } catch (e) {
    console.error(e)
  }
}

run()
