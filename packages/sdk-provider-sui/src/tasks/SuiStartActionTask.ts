import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import type { SuiTaskExtra } from './types.js'

export class SuiStartActionTask implements ExecutionTask<SuiTaskExtra, void> {
  readonly type = 'SUI_START_ACTION'
  readonly displayName = 'Start action'

  async shouldRun(context: TaskContext<SuiTaskExtra>): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  async execute(context: TaskContext<SuiTaskExtra>): Promise<TaskResult<void>> {
    const { step, statusManager, actionType } = context
    context.action = statusManager.updateAction(step, actionType, 'STARTED')
    return { status: 'COMPLETED' }
  }
}
