import {
  convertQuoteToRoute,
  type ExecutionAction,
  type ExecutionOptions,
  getContractCallsQuote,
  getRelayerQuote,
  getStepTransaction,
  LiFiErrorCode,
  type LiFiStep,
  type LiFiStepExtended,
  patchContractCalls,
  type SDKClient,
  type SignedTypedData,
  type StatusManager,
  stepComparison,
  TransactionError,
  type TransactionParameters,
} from '@lifi/sdk'
import type { Client } from 'viem'
import { getMaxPriorityFeePerGas } from '../../actions/getMaxPriorityFeePerGas.js'
import { PatcherMagicNumber } from '../../permits/constants.js'
import { isContractCallStep } from '../../utils/isContractCallStep.js'
import { isGaslessStep } from '../../utils/isGaslessStep.js'
import { isRelayerStep } from '../../utils/isRelayerStep.js'

export interface PrepareUpdatedStepDeps {
  statusManager: StatusManager
  executionOptions?: ExecutionOptions
  checkClient: (
    step: LiFiStepExtended,
    action: ExecutionAction,
    targetChainId?: number
  ) => Promise<Client | undefined>
  allowUserInteraction: boolean
  ethereumClient: Client
}

export async function prepareUpdatedStep(
  client: SDKClient,
  step: LiFiStepExtended,
  action: ExecutionAction,
  signedTypedData: SignedTypedData[] | undefined,
  deps: PrepareUpdatedStepDeps
): Promise<{
  transactionRequest: TransactionParameters | undefined
  isRelayerTransaction: boolean
} | null> {
  const { execution, ...stepBase } = step
  const relayerStep = isRelayerStep(step)
  const gaslessStep = isGaslessStep(step)
  const contractCallStep = isContractCallStep(step)
  let updatedStep: LiFiStep

  if (contractCallStep) {
    const contractCallsResult = await deps.executionOptions?.getContractCalls?.(
      {
        fromAddress: stepBase.action.fromAddress!,
        fromAmount: BigInt(stepBase.action.fromAmount),
        fromChainId: stepBase.action.fromChainId,
        fromTokenAddress: stepBase.action.fromToken.address,
        slippage: stepBase.action.slippage,
        toAddress: stepBase.action.toAddress,
        toAmount: BigInt(stepBase.estimate.toAmount),
        toChainId: stepBase.action.toChainId,
        toTokenAddress: stepBase.action.toToken.address,
      }
    )

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

    const contractCallQuote = await getContractCallsQuote(client, {
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
        deps.executionOptions?.adjustZeroOutputFromPreviousStep,
    })
    updatedStep = { ...route.steps[0], id: stepBase.id }
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
    updatedStep = { ...updatedRelayedStep, id: stepBase.id }
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

  const comparedStep = await stepComparison(
    deps.statusManager,
    step,
    updatedStep,
    deps.allowUserInteraction,
    deps.executionOptions
  )
  Object.assign(step, {
    ...comparedStep,
    execution: step.execution,
    typedData: updatedStep.typedData ?? step.typedData,
  })

  if (!step.transactionRequest && !step.typedData?.length) {
    throw new TransactionError(
      LiFiErrorCode.TransactionUnprepared,
      'Unable to prepare transaction.'
    )
  }

  let transactionRequest: TransactionParameters | undefined
  if (step.transactionRequest) {
    let maxPriorityFeePerGas: bigint | undefined
    if (deps.ethereumClient.account?.type === 'local') {
      const updatedClient = await deps.checkClient(step, action)
      if (!updatedClient) {
        return null
      }
      maxPriorityFeePerGas = await getMaxPriorityFeePerGas(
        client,
        updatedClient
      )
    } else {
      maxPriorityFeePerGas = step.transactionRequest.maxPriorityFeePerGas
        ? BigInt(step.transactionRequest.maxPriorityFeePerGas)
        : undefined
    }
    transactionRequest = {
      chainId: step.transactionRequest.chainId,
      to: step.transactionRequest.to,
      from: step.transactionRequest.from,
      data: step.transactionRequest.data,
      value: step.transactionRequest.value
        ? BigInt(step.transactionRequest.value)
        : undefined,
      gas: step.transactionRequest.gasLimit
        ? BigInt(step.transactionRequest.gasLimit)
        : undefined,
      maxPriorityFeePerGas,
    }
  }

  if (
    deps.executionOptions?.updateTransactionRequestHook &&
    transactionRequest
  ) {
    const customizedTransactionRequest: TransactionParameters =
      await deps.executionOptions.updateTransactionRequestHook({
        requestType: 'transaction',
        ...transactionRequest,
      })
    transactionRequest = {
      ...transactionRequest,
      ...customizedTransactionRequest,
    }
  }

  return {
    transactionRequest,
    isRelayerTransaction: isRelayerStep(updatedStep),
  }
}
