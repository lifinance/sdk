import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { checkBalance } from '@lifi/sdk'
import type { SuiTaskExtra } from './types.js'

export class SuiCheckBalanceTask implements ExecutionTask<SuiTaskExtra, void> {
  readonly type = 'SUI_CHECK_BALANCE'
  readonly displayName = 'Check balance'

  async shouldRun(context: TaskContext<SuiTaskExtra>): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  async execute(context: TaskContext<SuiTaskExtra>): Promise<TaskResult<void>> {
    const { client, step, statusManager, actionType } = context
    context.action = statusManager.updateAction(step, actionType, 'STARTED')
    await checkBalance(client, step.action.fromAddress!, step)
    return { status: 'COMPLETED' }
  }
}
