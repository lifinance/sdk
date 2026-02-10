import {
  BaseStepExecutionTask,
  checkBalance,
  type ExecutionAction,
  LiFiErrorCode,
  type SignedTypedData,
  stepComparison,
  type TaskContext,
  type TaskResult,
  TransactionError,
  type TransactionParameters,
} from '@lifi/sdk'
import { getMaxPriorityFeePerGas } from '../actions/getMaxPriorityFeePerGas.js'
import type { Call } from '../types.js'
import { getUpdatedStep } from './helpers/getUpdatedStep.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumPrepareTransactionTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction,
    payload: {
      signedTypedData: SignedTypedData[]
      calls: Call[]
    }
  ): Promise<TaskResult> {
    const {
      step,
      client,
      executionOptions,
      statusManager,
      allowUserInteraction,
      checkClient,
      ethereumClient,
    } = context

    const { signedTypedData, calls } = payload

    statusManager.updateAction(step, action.type, 'STARTED')

    const walletAddress = step.action.fromAddress
    if (!walletAddress) {
      throw new TransactionError(
        LiFiErrorCode.InternalError,
        'The wallet address is undefined.'
      )
    }

    // Check if the wallet has enough balance to cover the transaction
    await checkBalance(client, walletAddress, step)

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
        'Unable to prepare transaction.'
      )
    }

    let transactionRequest: TransactionParameters | undefined
    if (step.transactionRequest) {
      // Only call checkClient for local accounts when we need to get maxPriorityFeePerGas
      let maxPriorityFeePerGas: bigint | undefined
      if (ethereumClient.account?.type === 'local') {
        const updatedClient = await checkClient(step, action)
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

    return {
      status: 'COMPLETED',
      data: {
        signedTypedData,
        calls,
        transactionRequest,
      },
    }
  }
}
