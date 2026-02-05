import {
  BaseStepExecutionTask,
  type ExecutionAction,
  LiFiErrorCode,
  type TaskContext,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Address, Hash, Hex } from 'viem'
import { sendCalls } from 'viem/actions'
import { getAction } from 'viem/utils'
import { checkClient as checkClientHelper } from '../helpers/checkClient.js'
import { shouldRunSignAndExecute } from '../helpers/signAndExecuteTaskHelpers.js'
import type { EthereumTaskExtra } from '../types.js'

/** Batch execution: sendCalls (EIP-5792) with approval calls + transfer call. */
export class EthereumBatchSignAndExecuteTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  void
> {
  readonly type = 'ETHEREUM_BATCH_SIGN_AND_EXECUTE'
  readonly actionType = 'EXCHANGE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    _action?: ExecutionAction
  ): Promise<boolean> {
    return (
      context.executionStrategy === 'batch' &&
      shouldRunSignAndExecute(context, _action)
    )
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction
  ): Promise<TaskResult<void>> {
    context.calls = context.calls ?? []
    const { step, fromChain, statusManager, transactionRequest } = context
    const calls = context.calls

    if (!transactionRequest) {
      throw new TransactionError(
        LiFiErrorCode.TransactionUnprepared,
        'Unable to prepare transaction. Transaction request is not found.'
      )
    }

    const updatedClient = await checkClientHelper(
      step,
      action,
      undefined,
      context.getClient,
      context.setClient,
      context.statusManager,
      context.allowUserInteraction,
      context.switchChain
    )
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const transferCall = {
      chainId: fromChain.id,
      data: transactionRequest.data as Hex,
      to: transactionRequest.to as Address,
      value: transactionRequest.value,
    }
    calls.push(transferCall)

    const { id } = await getAction(
      updatedClient,
      sendCalls,
      'sendCalls'
    )({
      account: updatedClient.account!,
      calls,
    })

    statusManager.updateAction(step, action.type, 'PENDING', {
      taskId: id as Hash,
      txType: 'batched',
    })
    return { status: 'COMPLETED' }
  }
}
