import type { ContractCallQuoteRequest, LiFiStep } from '@lifi/sdk'
import { ChainId } from '@lifi/sdk'
import { ethers } from 'ethers'
import {
  executeCrossChainQuote,
  getLifi,
  getSigner,
  promptConfirm,
} from '../helpers'

const getKlimaQuote = async (
  fromChain: ChainId,
  fromToken: string,
  userAddress: string,
  retireAmount: string
): Promise<LiFiStep> => {
  const USDC_POL = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
  const BCT_POL = '0x2F800Db0fdb5223b3C3f354886d907A671414A7F'

  // https://docs.klimadao.finance/developers/contracts/retirement/v2-diamond/generalized-retirement
  const KLIMA_ETHEREUM_CONTRACT_OPT =
    '0x8cE54d9625371fb2a068986d32C85De8E6e995f8'
  const KLIMA_ABI = [
    'function getSourceAmountDefaultRetirement(address,address,uint256) external view returns (uint256 amountIn)',
    'function retireExactCarbonDefault(address, address, uint256, uint256, string, address, string, string, uint8)',
  ]
  const KLIMA_GAS_LIMIT = '1300000'

  // setup contract
  const provider = await getLifi().getRpcProvider(ChainId.POL) // TODO: question: what to replace this with
  const contract = new ethers.Contract( // TODO: question: how do we do this without ethers?
    KLIMA_ETHEREUM_CONTRACT_OPT,
    KLIMA_ABI,
    provider
  )

  // get usdc amount
  const getUsdcAmountResult = await contract.getSourceAmountDefaultRetirement(
    USDC_POL, // address sourceToken,
    BCT_POL, // address poolToken,
    retireAmount // uint256 retireAmount,
  )
  const usdcAmount = getUsdcAmountResult.toString()

  // contract call
  const retireTx = await contract.populateTransaction.retireExactCarbonDefault(
    USDC_POL, // address sourceToken,
    BCT_POL, // address poolToken,
    usdcAmount, // uint256 maxAmountIn,
    retireAmount, // uint256 retireAmount,
    'LI.FI', // string memory retiringEntityString,
    '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0', // address beneficiaryAddress,
    'LI.FI', // string memory beneficiaryString,
    'Cross Chain Contract Calls', // string memory retirementMessage,
    0 // LibTransfer.From fromMode
  )

  // quote
  const quoteRequest: ContractCallQuoteRequest = {
    fromChain,
    fromToken,
    fromAddress: userAddress,
    toChain: ChainId.POL,
    toToken: USDC_POL,
    toAmount: usdcAmount,
    toContractAddress: retireTx.to!,
    toContractCallData: retireTx.data!,
    toContractGasLimit: KLIMA_GAS_LIMIT,
  }

  return getLifi().getContractCallQuote(quoteRequest) // TODO: move this to use getContractCallsQuote function as in Multihop
}

const run = async () => {
  console.log('Klima Retire Demo: Retire(burn) Carbon tokens to offset CO2')

  // config
  const fromChain = ChainId.OPT
  const fromToken = ethers.constants.AddressZero // TODO: remove ethers
  const retireAmount = ethers.utils.parseEther('1').toString() // TODO: remove ethers

  try {
    const signer = await getSigner(fromChain) // TODO: set up SDK with viem
    // get quote
    const quote = await getKlimaQuote(
      fromChain,
      fromToken,
      await signer.getAddress(),
      retireAmount
    )
    console.log('Quote', quote)

    // continue?
    if (!(await promptConfirm('Execute Quote?'))) {
      return
    }

    // execute quote
    await executeCrossChainQuote(signer, quote) // TODO: use new version as with Multihop
  } catch (e) {
    console.error(e)
  }
}

run()
