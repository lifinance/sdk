import {
  convertQuoteToRoute,
  type ExecutionOptions,
  getContractCallsQuote,
  getRelayerQuote,
  getStepTransaction,
  LiFiErrorCode,
  type LiFiStepExtended,
  patchContractCalls,
  type SDKClient,
  type SignedTypedData,
  TransactionError,
} from '@lifi/sdk'
import { PatcherMagicNumber } from '../../../permits/constants.js'
import { isContractCallStep } from '../../../utils/isContractCallStep.js'
import { isGaslessStep } from '../../../utils/isGaslessStep.js'
import { isRelayerStep } from '../../../utils/isRelayerStep.js'

export const getUpdatedStep = async (
  client: SDKClient,
  step: LiFiStepExtended,
  executionOptions?: ExecutionOptions,
  signedTypedData?: SignedTypedData[]
): Promise<LiFiStepExtended> => {
  if (isContractCallStep(step)) {
    return getContractCallUpdatedStep(client, step, executionOptions)
  }
  if (isRelayerStep(step) && isGaslessStep(step)) {
    return getRelayerUpdatedStep(client, step)
  }
  return getStandardUpdatedStep(client, step, signedTypedData)
}

const getContractCallUpdatedStep = async (
  client: SDKClient,
  step: LiFiStepExtended,
  executionOptions?: ExecutionOptions
): Promise<LiFiStepExtended> => {
  const contractCallsResult = await executionOptions?.getContractCalls?.({
    fromAddress: step.action.fromAddress!,
    fromAmount: BigInt(step.action.fromAmount),
    fromChainId: step.action.fromChainId,
    fromTokenAddress: step.action.fromToken.address,
    slippage: step.action.slippage,
    toAddress: step.action.toAddress,
    toAmount: BigInt(step.estimate.toAmount),
    toChainId: step.action.toChainId,
    toTokenAddress: step.action.toToken.address,
  })

  if (!contractCallsResult?.contractCalls?.length) {
    throw new TransactionError(
      LiFiErrorCode.TransactionUnprepared,
      'Unable to prepare transaction. Contract calls are not found.'
    )
  }

  if (contractCallsResult.patcher) {
    const patchedContractCalls = await patchContractCalls(
      client,
      contractCallsResult.contractCalls.map((call) => ({
        chainId: step.action.toChainId,
        fromTokenAddress: call.fromTokenAddress,
        targetContractAddress: call.toContractAddress,
        callDataToPatch: call.toContractCallData,
        delegateCall: false,
        patches: [
          {
            amountToReplace: PatcherMagicNumber.toString(),
          },
        ],
      }))
    )

    contractCallsResult.contractCalls.forEach((call, index) => {
      call.toContractAddress = patchedContractCalls[index].target
      call.toContractCallData = patchedContractCalls[index].callData
    })
  }

  /**
   * Limitations of the retry logic for contract calls:
   * - denyBridges and denyExchanges are not supported
   * - allowBridges and allowExchanges are not supported
   * - fee is not supported
   * - toAmount is not supported
   */
  const contractCallQuote = await getContractCallsQuote(client, {
    fromAddress: step.action.fromAddress!,
    fromChain: step.action.fromChainId,
    fromToken: step.action.fromToken.address,
    fromAmount: step.action.fromAmount,
    toChain: step.action.toChainId,
    toToken: step.action.toToken.address,
    contractCalls: contractCallsResult.contractCalls,
    toFallbackAddress: step.action.toAddress,
    slippage: step.action.slippage,
  })

  contractCallQuote.action.toToken = step.action.toToken

  const customStep = contractCallQuote.includedSteps?.find(
    (s) => s.type === 'custom'
  )
  if (customStep && contractCallsResult?.contractTool) {
    const toolDetails = {
      key: contractCallsResult.contractTool.name,
      name: contractCallsResult.contractTool.name,
      logoURI: contractCallsResult.contractTool.logoURI,
    }
    customStep.toolDetails = toolDetails
    contractCallQuote.toolDetails = toolDetails
  }

  const route = convertQuoteToRoute(contractCallQuote, {
    adjustZeroOutputFromPreviousStep:
      executionOptions?.adjustZeroOutputFromPreviousStep,
  })

  return {
    ...route.steps[0],
    id: step.id,
  }
}

const getRelayerUpdatedStep = async (
  client: SDKClient,
  step: LiFiStepExtended
): Promise<LiFiStepExtended> => {
  const updatedRelayedStep = await getRelayerQuote(client, {
    fromChain: step.action.fromChainId,
    fromToken: step.action.fromToken.address,
    fromAddress: step.action.fromAddress!,
    fromAmount: step.action.fromAmount,
    toChain: step.action.toChainId,
    toToken: step.action.toToken.address,
    slippage: step.action.slippage,
    toAddress: step.action.toAddress,
    allowBridges: [step.tool],
  })
  return {
    ...updatedRelayedStep,
    id: step.id,
  }
}

const getStandardUpdatedStep = async (
  client: SDKClient,
  step: LiFiStepExtended,
  signedTypedData?: SignedTypedData[]
): Promise<LiFiStepExtended> => {
  const filteredSignedTypedData = signedTypedData?.filter(
    (item) => item.signature
  )
  const { typedData: _, ...restStep } = step
  const params = filteredSignedTypedData?.length
    ? { ...restStep, typedData: filteredSignedTypedData }
    : restStep
  return getStepTransaction(client, params)
}
