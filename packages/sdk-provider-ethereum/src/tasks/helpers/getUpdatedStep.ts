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
import { PatcherMagicNumber } from '../../permits/constants.js'
import { isContractCallStep } from '../../utils/isContractCallStep.js'
import { isGaslessStep } from '../../utils/isGaslessStep.js'
import { isRelayerStep } from '../../utils/isRelayerStep.js'

export const getUpdatedStep = async (
  client: SDKClient,
  step: LiFiStepExtended,
  executionOptions?: ExecutionOptions,
  signedTypedData?: SignedTypedData[]
): Promise<LiFiStepExtended> => {
  const { ...stepBase } = step
  let updatedStep: LiFiStepExtended
  const relayerStep = isRelayerStep(step)
  const gaslessStep = isGaslessStep(step)
  const contractCallStep = isContractCallStep(step)
  if (contractCallStep) {
    const contractCallsResult = await executionOptions?.getContractCalls?.({
      fromAddress: stepBase.action.fromAddress!,
      fromAmount: BigInt(stepBase.action.fromAmount),
      fromChainId: stepBase.action.fromChainId,
      fromTokenAddress: stepBase.action.fromToken.address,
      slippage: stepBase.action.slippage,
      toAddress: stepBase.action.toAddress,
      toAmount: BigInt(stepBase.estimate.toAmount),
      toChainId: stepBase.action.toChainId,
      toTokenAddress: stepBase.action.toToken.address,
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
          chainId: stepBase.action.toChainId,
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
      // Contract calls are enabled only when fromAddress is set
      fromAddress: stepBase.action.fromAddress!,
      fromChain: stepBase.action.fromChainId,
      fromToken: stepBase.action.fromToken.address,
      fromAmount: stepBase.action.fromAmount,
      toChain: stepBase.action.toChainId,
      toToken: stepBase.action.toToken.address,
      contractCalls: contractCallsResult.contractCalls,
      toFallbackAddress: stepBase.action.toAddress,
      slippage: stepBase.action.slippage,
    })

    contractCallQuote.action.toToken = stepBase.action.toToken

    const customStep = contractCallQuote.includedSteps?.find(
      (step) => step.type === 'custom'
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

    updatedStep = {
      ...route.steps[0],
      id: stepBase.id,
    }
  } else if (relayerStep && gaslessStep) {
    const updatedRelayedStep = await getRelayerQuote(client, {
      fromChain: stepBase.action.fromChainId,
      fromToken: stepBase.action.fromToken.address,
      fromAddress: stepBase.action.fromAddress!,
      fromAmount: stepBase.action.fromAmount,
      toChain: stepBase.action.toChainId,
      toToken: stepBase.action.toToken.address,
      slippage: stepBase.action.slippage,
      toAddress: stepBase.action.toAddress,
      allowBridges: [stepBase.tool],
    })
    updatedStep = {
      ...updatedRelayedStep,
      id: stepBase.id,
    }
  } else {
    const filteredSignedTypedData = signedTypedData?.filter(
      (item) => item.signature
    )
    const { typedData: _, ...restStepBase } = stepBase
    const params = filteredSignedTypedData?.length
      ? { ...restStepBase, typedData: filteredSignedTypedData }
      : restStepBase
    updatedStep = await getStepTransaction(client, params)
  }
  return updatedStep
}
