import type { ContractCallQuoteRequest, LiFiStep } from '@lifi/sdk'
import { ChainId } from '@lifi/sdk'
import { ethers } from 'ethers'
import {
  executeCrossChainQuote,
  getLifi,
  getSigner,
  promptConfirm,
} from '../helpers'

const getPolynomialQuote = async (
  fromChain: ChainId,
  fromToken: string,
  userAddress: string,
  amount: string
): Promise<LiFiStep> => {
  const sETH_OPT = '0xE405de8F52ba7559f9df3C368500B6E6ae6Cee49'
  const POLYNOMIAL_ETHEREUM_CONTRACT_OPT =
    '0x2D46292cbB3C601c6e2c74C32df3A4FCe99b59C7'
  const POLYNOMIAL_ABI = [
    'function initiateDeposit(address user, uint amount) external',
  ]
  const POLYNOMIAL_GAS_LIMIT = '200000'

  // contract call
  const contract = new ethers.Contract(
    POLYNOMIAL_ETHEREUM_CONTRACT_OPT,
    POLYNOMIAL_ABI
  )
  const stakeTx = await contract.populateTransaction.initiateDeposit(
    userAddress,
    amount
  )

  // quote
  const quoteRequest: ContractCallQuoteRequest = {
    fromChain,
    fromToken,
    fromAddress: userAddress,
    toChain: ChainId.OPT,
    toToken: sETH_OPT,
    toAmount: amount,
    toContractAddress: stakeTx.to!,
    toContractCallData: stakeTx.data!,
    toContractGasLimit: POLYNOMIAL_GAS_LIMIT,
  }

  return getLifi().getContractCallQuote(quoteRequest)
}

const run = async () => {
  console.log('Polynomial Demo: Deposit sETH on Optimism')

  // config
  const fromChain = ChainId.ETH
  const fromToken = ethers.constants.AddressZero
  const amount = ethers.utils.parseEther('0.04').toString()

  try {
    const signer = await getSigner(fromChain)
    // get quote
    const quote = await getPolynomialQuote(
      fromChain,
      fromToken,
      await signer.getAddress(),
      amount
    )
    console.log('Quote', quote)

    // continue?
    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

    // execute quote
    await executeCrossChainQuote(signer, quote)
  } catch (e) {
    console.error(e)
  }
}

run()
