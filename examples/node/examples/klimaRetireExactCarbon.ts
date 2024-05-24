import type { ContractCallsQuoteRequest, LiFiStep } from '@lifi/sdk'
import { ChainId, getContractCallsQuote } from '@lifi/sdk'
import type { Chain } from 'viem'
import { parseEther, parseAbi, getContract, encodeFunctionData } from 'viem'
import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import { promptConfirm } from '../helpers/promptConfirm'
import { executeCrossChainQuote } from './utils/executeCrossChainQuote'
import { setUpSDK } from './utils/setUpSDK'
import { WalletClientWithPublicActions } from './types'
import { AddressZero } from './constants'

const USDC_POL = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
const BCT_POL = '0x2F800Db0fdb5223b3C3f354886d907A671414A7F'

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

  const contract = getContract({
    address: KLIMA_ETHEREUM_CONTRACT_POL,
    abi,
    client: client as any,
  })

  console.info('>> got contract:', contract)

  const sourceAmountDefaultRetirement = await (
    contract as any
  ).read.getSourceAmountDefaultRetirement([
    USDC_POL, // address sourceToken,
    BCT_POL, // address poolToken,
    retireAmount, // uint256 retireAmount,
  ])

  const usdcAmount = sourceAmountDefaultRetirement.toString()

  const retireTxData = encodeFunctionData({
    abi,
    functionName: 'retireExactCarbonDefault',
    args: [
      USDC_POL, // address sourceToken,
      BCT_POL, // address poolToken,
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
    toToken: USDC_POL,
    toAmount: usdcAmount,
    contractCalls: [
      {
        fromAmount: usdcAmount, // TODO: is this the right value? not sure what it should be
        fromTokenAddress: fromToken, // TODO: is this the right value? not sure what it should be
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
    initialChain: polygon as Chain,
    switchChains: [mainnet, arbitrum, optimism, polygon] as Chain[],
    usePublicActions: true,
  })

  // config
  const fromChain = ChainId.OPT
  const fromToken = AddressZero
  const retireAmount = parseEther('1').toString()

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
