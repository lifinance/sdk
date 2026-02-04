import {
  BaseStepExecutionTask,
  LiFiErrorCode,
  type TaskContext,
  type TaskResult,
  TransactionError,
} from '@lifi/sdk'
import type { Address, Hash, Hex } from 'viem'
import { sendCalls } from 'viem/actions'
import { getAction } from 'viem/utils'
import { checkClient as checkClientHelper } from './helpers/checkClient.js'
import { shouldRunSignAndExecute } from './helpers/signAndExecuteTaskHelpers.js'
import type { EthereumTaskExtra } from './types.js'

/** Batch execution: sendCalls (EIP-5792) with approval calls + transfer call. */
export class EthereumSignAndExecuteBatchTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  void
> {
  readonly type = 'ETHEREUM_SIGN_AND_EXECUTE_BATCH'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    return (
      context.executionStrategy === 'batch' && shouldRunSignAndExecute(context)
    )
  }

  protected override async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    context.calls = context.calls ?? []
    const {
      step,
      fromChain,
      action,
      actionType,
      statusManager,
      transactionRequest,
    } = context
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

    context.action = statusManager.updateAction(step, actionType, 'PENDING', {
      taskId: id as Hash,
      txType: 'batched',
    })
    return { status: 'COMPLETED' }
  }
}
