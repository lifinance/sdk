import type { TaskContext, TaskResult } from '@lifi/sdk'
import { checkBalance } from '@lifi/sdk'
import { SuiStepExecutionTask } from './SuiStepExecutionTask.js'
import type { SuiTaskExtra } from './types.js'

export class SuiCheckBalanceTask extends SuiStepExecutionTask<void> {
  readonly type = 'SUI_CHECK_BALANCE'

  override async shouldRun(
    context: TaskContext<SuiTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  protected override async run(
    context: TaskContext<SuiTaskExtra>
  ): Promise<TaskResult<void>> {
    const { client, step, statusManager, actionType } = context
    context.action = statusManager.updateAction(step, actionType, 'STARTED')
    await checkBalance(client, step.action.fromAddress!, step)
    return { status: 'COMPLETED' }
  }
}
