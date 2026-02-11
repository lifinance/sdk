import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import type { EthereumStepExecutorContext } from '../types.js'
import { waitForApprovalTransaction } from './helpers/waitForApprovalTransaction.js'

export class EthereumWaitForApprovalTransactionTask extends BaseStepExecutionTask {
  override async shouldRun(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionExecuted(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step, client, fromChain, statusManager, checkClient } = context

    const updatedClient = await checkClient(step, action)
    if (!updatedClient) {
      return { status: 'PAUSED' }
    }

    // Handle existing pending transaction
    await waitForApprovalTransaction(
      client,
      updatedClient,
      action.txHash as Address,
      action.type,
      step,
      fromChain,
      statusManager
    )

    return {
      status: 'COMPLETED',
    }
  }
}
