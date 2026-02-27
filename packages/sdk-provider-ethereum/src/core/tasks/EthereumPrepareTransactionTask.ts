import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  stepComparison,
  type TaskResult,
  TransactionError,
  type TransactionParameters,
} from '@lifi/sdk'
import { getMaxPriorityFeePerGas } from '../../actions/getMaxPriorityFeePerGas.js'
import type { EthereumStepExecutorContext } from '../../types.js'
import { getEthereumExecutionStrategy } from './helpers/getEthereumExecutionStrategy.js'
import { getUpdatedStep } from './helpers/getUpdatedStep.js'

export class EthereumPrepareTransactionTask extends BaseStepExecutionTask {
  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      client,
      executionOptions,
      statusManager,
      allowUserInteraction,
      checkClient,
      isBridgeExecution,
      signedTypedData,
      ethereumClient,
    } = context

    const action = statusManager.findAction(
      step,
      isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    )

    if (!action) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Action not found.'
      )
    }

    // Try to prepare a new transaction request and update the step with typed data
    const updatedStep = await getUpdatedStep(
      client,
      step,
      executionOptions,
      signedTypedData
    )

    const comparedStep = await stepComparison(
      statusManager,
      step,
      updatedStep,
      allowUserInteraction,
      executionOptions
    )

    Object.assign(step, {
      ...comparedStep,
      execution: step.execution,
      typedData: updatedStep.typedData ?? step.typedData,
    })

    if (!step.transactionRequest && !step.typedData?.length) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Transaction request is not found.'
      )
    }

    let transactionRequest: TransactionParameters | undefined
    if (step.transactionRequest) {
      // Only fetch maxPriorityFeePerGas for local accounts
      let maxPriorityFeePerGas: bigint | undefined
      if (ethereumClient.account?.type === 'local') {
        const updatedClient = await checkClient(step)
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
        // gasPrice: step.transactionRequest.gasPrice
        //   ? BigInt(step.transactionRequest.gasPrice as string)
        //   : undefined,
        // maxFeePerGas: step.transactionRequest.maxFeePerGas
        //   ? BigInt(step.transactionRequest.maxFeePerGas as string)
        //   : undefined,
        maxPriorityFeePerGas,
      }
    }

    if (executionOptions?.updateTransactionRequestHook && transactionRequest) {
      const customizedTransactionRequest: TransactionParameters =
        await executionOptions.updateTransactionRequestHook({
          requestType: 'transaction',
          ...transactionRequest,
        })
      transactionRequest = {
        ...transactionRequest,
        ...customizedTransactionRequest,
      }
    }

    // Recompute execution strategy after PrepareTransaction mutates step
    const executionStrategy = await getEthereumExecutionStrategy(context, true)

    return {
      status: 'COMPLETED',
      context: { transactionRequest, executionStrategy },
    }
  }
}
