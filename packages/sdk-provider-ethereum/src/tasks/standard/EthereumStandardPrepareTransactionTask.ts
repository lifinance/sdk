import {
  BaseStepExecutionTask,
  convertQuoteToRoute,
  type ExecutionAction,
  getContractCallsQuote,
  getStepTransaction,
  LiFiErrorCode,
  type LiFiStep,
  type LiFiStepExtended,
  patchContractCalls,
  stepComparison,
  type TaskContext,
  type TaskResult,
  TransactionError,
  type TransactionParameters,
} from '@lifi/sdk'
import { getMaxPriorityFeePerGas } from '../../actions/getMaxPriorityFeePerGas.js'
import { PatcherMagicNumber } from '../../permits/constants.js'
import { isContractCallStep } from '../../utils/isContractCallStep.js'
import { checkClient as checkClientHelper } from '../helpers/checkClient.js'
import type {
  EthereumPrepareTransactionResult,
  EthereumTaskExtra,
} from '../types.js'

/** Standard execution: contract call quote or getStepTransaction, then build tx request. */
export class EthereumStandardPrepareTransactionTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  EthereumPrepareTransactionResult
> {
  readonly type = 'ETHEREUM_STANDARD_PREPARE_TRANSACTION'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    if (context.executionStrategy !== 'standard') {
      return false
    }
    return !context.isTransactionExecuted(action)
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult<EthereumPrepareTransactionResult>> {
    const signedTypedData = context.signedTypedData ?? []
    const { client, step, allowUserInteraction, statusManager } = context
    const checkClient = (s: LiFiStepExtended, a: typeof action, tid?: number) =>
      checkClientHelper(
        s,
        a,
        tid,
        context.getClient,
        context.setClient,
        context.statusManager,
        context.allowUserInteraction,
        context.switchChain
      )

    const { execution, ...stepBase } = step
    const contractCallStep = isContractCallStep(step)
    let updatedStep: LiFiStep

    if (contractCallStep) {
      const contractCallsResult =
        await context.executionOptions?.getContractCalls?.({
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
          context.executionOptions?.adjustZeroOutputFromPreviousStep,
      })
      updatedStep = { ...route.steps[0], id: stepBase.id }
    } else {
      const filteredSignedTypedData = signedTypedData?.filter(
        (item) => item.signature
      )
      const { typedData: _typedData, ...restStepBase } = stepBase
      const params = filteredSignedTypedData?.length
        ? { ...restStepBase, typedData: filteredSignedTypedData }
        : restStepBase
      updatedStep = await getStepTransaction(client, params)
    }

    const comparedStep = await stepComparison(
      statusManager,
      step,
      updatedStep,
      allowUserInteraction,
      context.executionOptions
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
      if (context.ethereumClient.account?.type === 'local') {
        const updatedClient = await checkClient(step, action, undefined)
        if (!updatedClient) {
          return { status: 'PAUSED' }
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
      context.executionOptions?.updateTransactionRequestHook &&
      transactionRequest
    ) {
      const customizedTransactionRequest: TransactionParameters =
        await context.executionOptions.updateTransactionRequestHook({
          requestType: 'transaction',
          ...transactionRequest,
        })
      transactionRequest = {
        ...transactionRequest,
        ...customizedTransactionRequest,
      }
    }

    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    return {
      status: 'COMPLETED',
      data: {
        transactionRequest,
        isRelayerTransaction: false,
      },
    }
  }
}
