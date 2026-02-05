import {
  BaseStepExecutionTask,
  getStepTransaction,
  LiFiErrorCode,
  type LiFiStep,
  type LiFiStepExtended,
  stepComparison,
  type TaskContext,
  type TaskResult,
  TransactionError,
  type TransactionParameters,
} from '@lifi/sdk'
import { getMaxPriorityFeePerGas } from '../../actions/getMaxPriorityFeePerGas.js'
import { checkClient as checkClientHelper } from '../helpers/checkClient.js'
import type {
  EthereumPrepareTransactionResult,
  EthereumTaskExtra,
} from '../types.js'

/** Batch execution: getStepTransaction for transfer call, then build tx request for sendCalls. */
export class EthereumBatchPrepareTransactionTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  EthereumPrepareTransactionResult
> {
  readonly type = 'ETHEREUM_BATCH_PREPARE_TRANSACTION'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    if (context.executionStrategy !== 'batch') {
      return false
    }
    return !context.isTransactionExecuted()
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<EthereumPrepareTransactionResult>> {
    const actionType = context.isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    const action = context.getOrCreateAction(actionType)
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
    const filteredSignedTypedData = signedTypedData?.filter(
      (item) => item.signature
    )
    const { typedData: _typedData, ...restStepBase } = stepBase
    const params = filteredSignedTypedData?.length
      ? { ...restStepBase, typedData: filteredSignedTypedData }
      : restStepBase
    const updatedStep: LiFiStep = await getStepTransaction(client, params)

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

    statusManager.updateAction(step, actionType, 'ACTION_REQUIRED')

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
