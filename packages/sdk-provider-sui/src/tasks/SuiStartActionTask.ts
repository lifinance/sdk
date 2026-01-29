import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import type { SuiTaskExtra } from './types.js'

export class SuiStartActionTask implements ExecutionTask<SuiTaskExtra, void> {
  readonly type = 'SUI_START_ACTION'
  readonly displayName = 'Start action'

  async shouldRun(context: TaskContext<SuiTaskExtra>): Promise<boolean> {
    const { action } = context.extra
    // Don't reset status if we already have a broadcasted tx
    if (action.txHash) {
      return false
    }
    return action.status !== 'DONE'
  }

  async execute(context: TaskContext<SuiTaskExtra>): Promise<TaskResult<void>> {
    const { step, extra } = context
    extra.action = extra.statusManager.updateAction(
      step,
      extra.actionType,
      'STARTED'
    )
    return { status: 'COMPLETED' }
  }
}
