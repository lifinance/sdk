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
} from '@lifi/sdk'
import type { Call } from '../types.js'
import { EthereumSignAndExecuteTask } from './EthereumSignAndExecuteTask.js'
import { getUpdatedStep } from './helpers/getUpdatedStep.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumPrepareTransactionTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_PREPARE_TRANSACTION'
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
      client,
      executionOptions,
      statusManager,
      allowUserInteraction,
    } = context

    const { signedTypedData, calls } = payload

    statusManager.updateAction(step, action.type, 'STARTED')
    await checkBalance(client, context.getWalletAddress(), step)

    const updatedStep = await getUpdatedStep(
      client,
      step,
      executionOptions,
      signedTypedData
    )

    if (!step.transactionRequest && !step.typedData?.length) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction.'
      )
    }

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

    return await new EthereumSignAndExecuteTask().execute(context, {
      signedTypedData,
      calls,
    })
  }
}
