import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
  TransactionError,
  type TransactionParameters,
} from '@lifi/sdk'
import { getMaxPriorityFeePerGas } from '../actions/getMaxPriorityFeePerGas.js'
import type { Call } from '../types.js'
import { EthereumBatchSignAndExecuteTask } from './EthereumBatchSignAndExecuteTask.js'
import { EthereumRelayerSignAndExecuteTask } from './EthereumRelayerSignAndExecuteTask.js'
import { EthereumStandardSignAndExecuteTask } from './EthereumStandardSignAndExecuteTask.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumSignAndExecuteTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_SIGN_AND_EXECUTE'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction,
    payload: {
      signedTypedData: SignedTypedData[]
      calls: Call[]
    }
  ): Promise<TaskResult> {
    const {
      step,
      statusManager,
      allowUserInteraction,
      client,
      ethereumClient,
      checkClient,
      executionOptions,
    } = context

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

    statusManager.updateAction(step, action.type, 'ACTION_REQUIRED')

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    const { signedTypedData, calls } = payload
    const executionStrategy = await context.getExecutionStrategy(step)
    if (executionStrategy === 'batch' && transactionRequest) {
      return await new EthereumBatchSignAndExecuteTask().execute(context, {
        transactionRequest,
        calls,
      })
    }
    if (executionStrategy === 'relayer') {
      return await new EthereumRelayerSignAndExecuteTask().execute(context, {
        signedTypedData,
      })
    }
    return await new EthereumStandardSignAndExecuteTask().execute(context, {
      transactionRequest,
      signedTypedData,
    })
  }
}
