import {
  BaseStepExecutionTask,
  type ExecutionAction,
  isTransactionPending,
  type TaskResult,
} from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumBatchSetCallsTask } from './EthereumBatchSetCallsTask.js'
import { EthereumWaitForApprovalTransactionTask } from './EthereumWaitForApprovalTransaction.js'

export class EthereumGetApprovedAllowanceTask extends BaseStepExecutionTask {
  override async shouldRun(
    _context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return isTransactionPending(action)
  }

  async run(
    context: EthereumStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { step, statusManager, getExecutionStrategy } = context

    const strategy = await getExecutionStrategy(step)
    const batchingSupported = strategy === 'batch'

    statusManager.updateAction(step, action.type, 'PENDING')

    if (batchingSupported) {
      return new EthereumBatchSetCallsTask().run(context, action)
    }
    return new EthereumWaitForApprovalTransactionTask().run(context, action)
  }
}
