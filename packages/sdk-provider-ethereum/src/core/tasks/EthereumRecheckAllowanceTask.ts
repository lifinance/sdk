import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { EthereumStepExecutorContext } from '../../types.js'
import { EthereumCheckAllowanceTask } from './EthereumCheckAllowanceTask.js'
import { EthereumResetAllowanceTask } from './EthereumResetAllowanceTask.js'
import { EthereumSetAllowanceTask } from './EthereumSetAllowanceTask.js'
import { hasAllowanceSpenderChanged } from './helpers/hasAllowanceSpenderChanged.js'

/**
 * Runs after PrepareTransaction. Some providers only know the spender once
 * `/stepTransaction` builds the executable transaction, so the re-quote can
 * move `estimate.approvalAddress` after the allowance tasks approved the
 * routing-time one. The allowance is then read again for the new spender, and
 * reset and set only if it falls short, before the transaction is signed.
 *
 * Without this, the transaction goes out against a spender holding no
 * allowance and reverts. In `standard` the approval to the old spender is
 * already on-chain; this only adds the one the transaction needs.
 */
export class EthereumRecheckAllowanceTask extends BaseStepExecutionTask {
  private readonly allowanceTasks: BaseStepExecutionTask[] = [
    new EthereumCheckAllowanceTask(),
    new EthereumResetAllowanceTask(),
    new EthereumSetAllowanceTask(),
  ]

  override async shouldRun(
    context: EthereumStepExecutorContext
  ): Promise<boolean> {
    return hasAllowanceSpenderChanged(context)
  }

  async run(context: EthereumStepExecutorContext): Promise<TaskResult> {
    // Before prepare, only the allowance tasks queue calls, and those calls
    // approve the old spender: drop them so the batch carries the new ones.
    context.calls = []

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
