//error
import { ChainId, ContractCallQuoteRequest, LifiStep } from '@lifi/sdk'
import {
  executeCrossChainQuote,
  getLifi,
  getSigner,
  promptConfirm,
} from '../helpers'

const getMultihopQuote = async (
  fromChain: ChainId,
  fromToken: string,
  toChain: ChainId,
  toToken: string,
  usdAmount: number,
  userAddress: string
): Promise<LifiStep> => {
  const USDC_POL = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'

  // Get bridge route from polygon to destination chain
  const secondBridgeQuoteRequest = {
    fromChain: ChainId.POL,
    fromToken: USDC_POL,
    fromAddress: userAddress, // will actually be a relayer
    fromAmount: (usdAmount * 1_000_000).toString(),
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

const run = async () => {
  console.log('Multihop route USDC.AVA to DAI.DAI')

  // config
  const fromChain = ChainId.AVA
  const fromToken = '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e' // USDC
  const toChain = ChainId.DAI
  const toToken = '0x0000000000000000000000000000000000000000'
  const usdAmount = 1

  try {
    const signer = await getSigner(fromChain)
    // get quote
    const quote = await getMultihopQuote(
      fromChain,
      fromToken,
      toChain,
      toToken,
      usdAmount,
      await signer.getAddress()
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
