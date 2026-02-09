import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { waitForApprovalTransaction } from './helpers/waitForApprovalTransaction.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumWaitForApprovalTransactionTask extends BaseStepExecutionTask<EthereumTaskExtra> {
  readonly actionType = 'TOKEN_ALLOWANCE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    action?: ExecutionAction
  ): Promise<boolean> {
    return context.isTransactionExecuted(action)
  }

  async run(
    context: TaskContext<EthereumTaskExtra>,
    action: ExecutionAction,
    payload: {
      signedTypedData: SignedTypedData[]
    }
  ): Promise<TaskResult> {
    const { step, client, fromChain, statusManager, checkClient } = context
    const { signedTypedData } = payload

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
      data: {
        signedTypedData,
      },
    }
  }
}
