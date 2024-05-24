import type { ContractCallsQuoteRequest, LiFiStep } from '@lifi/sdk'
import { ChainId, getContractCallsQuote } from '@lifi/sdk'
import type { Chain, WalletClient } from 'viem'
import { encodeFunctionData, parseAbi, parseEther } from 'viem'
import { mainnet, arbitrum, optimism, polygon } from 'viem/chains'
import { promptConfirm } from '../helpers/promptConfirm'
import { executeCrossChainQuote } from './utils/executeCrossChainQuote'
import { setUpSDK } from './utils/setUpSDK'
import { WalletClientWithPublicActions } from './types'
import { AddressZero } from './constants'

const sETH_OPT = '0xE405de8F52ba7559f9df3C368500B6E6ae6Cee49'
const POLYNOMIAL_ETHEREUM_CONTRACT_OPT =
  '0x2D46292cbB3C601c6e2c74C32df3A4FCe99b59C7'
const POLYNOMIAL_ABI = [
  'function initiateDeposit(address user, uint amount) external',
]
const POLYNOMIAL_GAS_LIMIT = '200000'

const getPolynomialQuote = async (
  fromChain: ChainId,
  fromToken: string,
  client: WalletClient,
  userAddress: string,
  amount: string
): Promise<LiFiStep> => {
  const abi = parseAbi(POLYNOMIAL_ABI)

  const stakeTxData = encodeFunctionData({
    abi,
    functionName: 'initiateDeposit',
    args: [userAddress, amount],
  })

  const quoteRequest: ContractCallsQuoteRequest = {
    fromChain,
    fromToken,
    fromAddress: userAddress,
    toChain: ChainId.OPT,
    toToken: sETH_OPT,
    toAmount: amount,
    contractCalls: [
      {
        fromAmount: amount, // TODO: is this the right value? not sure what it should be
        fromTokenAddress: fromToken, // TODO: is this the right value? not sure what it should be
        toContractAddress: POLYNOMIAL_ETHEREUM_CONTRACT_OPT,
        toContractCallData: stakeTxData,
        toContractGasLimit: POLYNOMIAL_GAS_LIMIT,
      },
    ],
  }

  console.info('>> create contract calls quote request', quoteRequest)

  return getContractCallsQuote(quoteRequest)
}

const run = async () => {
  console.info('>> Starting Polynomial Demo: Deposit sETH on Optimism')
  // configure the chain token and amount to be used
  const fromChain = ChainId.ETH // TODO: consider changing this to optimism?
  const fromToken = AddressZero
  const amount = parseEther('0.04').toString()

  console.info('>> Initialize LiFi SDK')

  try {
    const { account, client } = setUpSDK({
      initialChain: mainnet,
      switchChains: [mainnet, arbitrum, optimism, polygon] as Chain[],
      usePublicActions: true,
    })

    const quote = await getPolynomialQuote(
      fromChain,
      fromToken,
      client,
      account.address,
      amount
    )

    console.info('>> Contract Calls Quote', quote)

    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

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
