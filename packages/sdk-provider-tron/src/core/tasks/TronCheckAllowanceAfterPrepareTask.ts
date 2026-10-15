import { BaseStepExecutionTask, TaskPipeline, type TaskResult } from '@lifi/sdk'
import type { TronStepExecutorContext } from '../../types.js'
import { isZeroAddress } from '../../utils/isZeroAddress.js'
import { TronCheckAllowanceTask } from './TronCheckAllowanceTask.js'
import { TronSetAllowanceTask } from './TronSetAllowanceTask.js'

/**
 * Runs after PrepareTransaction. Some providers only know the spender once
 * `/stepTransaction` builds the executable transaction, so the routing-time
 * step carries no `estimate.approvalAddress` and the allowance tasks before
 * prepare do not run. When the re-quote brings one, the allowance is read for
 * it, and set only if it falls short, before the transaction is signed.
 *
 * A spender that was already checked before prepare is not checked again.
 */
export class TronCheckAllowanceAfterPrepareTask extends BaseStepExecutionTask {
  private readonly allowancePipeline = new TaskPipeline([
    new TronCheckAllowanceTask(),
    new TronSetAllowanceTask(),
  ])

  override async shouldRun(context: TronStepExecutorContext): Promise<boolean> {
    const { step, hasSufficientAllowance } = context
    // `hasSufficientAllowance` is only set by the allowance tasks, so it is
    // unset exactly when none ran before prepare.
    return (
      hasSufficientAllowance === undefined &&
      !isZeroAddress(step.action.fromToken.address) &&
      !!step.estimate.approvalAddress &&
      !step.estimate.skipApproval
    )
  }

  async run(context: TronStepExecutorContext): Promise<TaskResult> {
    return this.allowancePipeline.run(context)
  }
}
