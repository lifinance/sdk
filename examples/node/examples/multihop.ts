//error
import type { ContractCallQuoteRequest, LiFiStep } from '@lifi/sdk'
import { ChainId } from '@lifi/sdk'
import {
  getLifi,
  getSigner,
} from '../helpers'
import { promptConfirm } from '../helpers/promptConfirm'
import {BigNumber, ethers, Signer} from "ethers";

interface GetMultihopQuoteParams {
  fromChain: ChainId
  fromToken: string
  toChain: ChainId
  toToken: string
  usdAmount: number
  userAddress: string
}

const getMultihopQuote = async ({
  fromChain,
  fromToken,
  toChain,
  toToken,
  usdAmount,
  userAddress,
}: GetMultihopQuoteParams): Promise<LiFiStep> => {
  // Get bridge route from polygon to destination chain
  const secondBridgeQuoteRequest = {
    fromChain: ChainId.POL,
    fromToken: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', //USDC POL // TODO: use data-types
    fromAddress: userAddress, // will actually be a relayer
    fromAmount: (usdAmount * 1_000_000).toString(), // TODO: question: change to be consistent with use data-types in swap and bridge?
    toChain,
    toToken,
    toAddress: userAddress,
    allowBridges: ['hop'],
  }
  const secondBridgeQuote = await getLifi().getQuote(secondBridgeQuoteRequest)
  console.log(secondBridgeQuote)

  // quote
  const quoteRequest: ContractCallQuoteRequest = {
    fromChain,
    fromToken,
    fromAddress: userAddress,
    toChain: secondBridgeQuote.action.fromChainId,
    toToken: secondBridgeQuote.action.fromToken.address,
    toAmount: secondBridgeQuote.action.fromAmount,
    toContractAddress: secondBridgeQuote.transactionRequest!.to!,
    toContractCallData: secondBridgeQuote.transactionRequest!.data!.toString(),
    toContractGasLimit:
      secondBridgeQuote.transactionRequest!.gasLimit!.toString(),
  }

  return getLifi().getContractCallQuote(quoteRequest)
}

// TODO: look at reuse once all examples are done
const executeCrossChainQuote = async (
  signer: Signer,
  quote: LiFiStep
) => {
  // Approval
  if (quote.action.fromToken.address !== ethers.constants.AddressZero) {
    // check approval
    const approval = await lifi.getTokenAllowance(
      signer,
      quote.action.fromToken,
      quote.estimate.approvalAddress
    )
    if (!approval) {
      throw 'Failed to load approval'
    }

    // set approval
    if (BigNumber.from(approval).lt(quote.action.fromAmount)) {
      await lifi.setTokenApproval({
        signer,
        token: quote.action.fromToken,
        amount: quote.action.fromAmount,
        approvalAddress: quote.estimate.approvalAddress,
      })
    }
  }

const run = async () => {
  console.info('>> Multihop route USDC.AVA to DAI.DAI')


  try {
    const signer = await getSigner(ChainId.AVA)

    const quoteConfig = {
      fromChain: ChainId.AVA,
      fromToken: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e' // USDC, // TODO: use data-types
      toChain: ChainId.DAI,
      toToken: '0x0000000000000000000000000000000000000000',
      usdAmount: 1, // TODO: question: change to be consistent with use data-types in swap and bridge?
      userAddress: await signer.getAddress(),
    }

    // get quote
    const quote = await getMultihopQuote(quoteConfig)

    console.info('>> Quote', quote)

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
