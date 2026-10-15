import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumCheckAllowanceTask } from './EthereumCheckAllowanceTask.js'
import { EthereumResetAllowanceTask } from './EthereumResetAllowanceTask.js'
import { EthereumSetAllowanceTask } from './EthereumSetAllowanceTask.js'
import { hasApprovalAddressAppearedAtPrepare } from './helpers/hasApprovalAddressAppearedAtPrepare.js'

/**
 * Runs after PrepareTransaction. Some providers only know the spender once
 * `/stepTransaction` builds the executable transaction, so the routing-time
 * step carries no `estimate.approvalAddress` and the allowance tasks before
 * prepare do not run. When the re-quote brings one, the allowance is read for
 * it, and reset and set only if it falls short, before the transaction is
 * signed.
 *
 * A spender that was already set before prepare is not checked again here.
 */
export class EthereumCheckAllowanceAfterPrepareTask extends BaseStepExecutionTask {
  private readonly allowanceTasks: BaseStepExecutionTask[] = [
    new EthereumCheckAllowanceTask(),
    new EthereumResetAllowanceTask(),
    new EthereumSetAllowanceTask(),
  ]

  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    return hasApprovalAddressAppearedAtPrepare(context)
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    for (const task of this.allowanceTasks) {
      if (!(await task.shouldRun(context))) {
        continue
      }
      const result = await task.run(context)
      if (result.status === 'PAUSED') {
        return result
      }
      Object.assign(context, result.context)
    }

    return { status: 'COMPLETED' }
  }
}
