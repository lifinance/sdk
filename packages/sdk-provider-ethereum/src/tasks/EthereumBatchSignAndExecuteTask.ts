import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskResult,
  type TransactionParameters,
} from '@lifi/sdk'
import type { Address, Hash, Hex } from 'viem'
import { sendCalls } from 'viem/actions'
import { getAction } from 'viem/utils'
import type { Call } from '../types.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumBatchSignAndExecuteTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly type = 'ETHEREUM_BATCH_SIGN_AND_EXECUTE'
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
      transactionRequest: TransactionParameters
      calls: Call[]
    }
  ): Promise<TaskResult> {
    const { ethereumClient, step, fromChain, statusManager } = context

    const updatedClient = await context.checkClient(step, action)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    const { transactionRequest, calls } = payload
    const transferCall: Call = {
      chainId: fromChain.id,
      data: transactionRequest.data as Hex,
      to: transactionRequest.to as Address,
      value: transactionRequest.value,
    }

    calls.push(transferCall)

    const { id } = await getAction(
      ethereumClient,
      sendCalls,
      'sendCalls'
    )({
      account: ethereumClient.account!,
      calls,
    })

    statusManager.updateAction(step, action.type, 'PENDING', {
      taskId: id as Hash,
      txType: 'batched',
      signedAt: Date.now(),
    })

    return { status: 'COMPLETED' }
  }
}
