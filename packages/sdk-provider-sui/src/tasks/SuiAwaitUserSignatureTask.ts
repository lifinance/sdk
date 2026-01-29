import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import type { SuiTaskExtra } from './types.js'

export class SuiAwaitUserSignatureTask
  implements ExecutionTask<SuiTaskExtra, void>
{
  readonly type = 'SUI_AWAIT_SIGNATURE'
  readonly displayName = 'Sign transaction'

  async shouldRun(context: TaskContext<SuiTaskExtra>): Promise<boolean> {
    const { action } = context.extra
    return !action.txHash && action.status !== 'DONE'
  }

  async execute(context: TaskContext<SuiTaskExtra>): Promise<TaskResult<void>> {
    const { step, extra, allowUserInteraction } = context

    extra.action = extra.statusManager.updateAction(
      step,
      extra.actionType,
      'ACTION_REQUIRED'
    )

    if (!allowUserInteraction) {
      return {
        status: 'PAUSED',
        saveState: {
          taskType: this.type,
          phase: 'AWAITING_SIGNATURE',
          data: {},
        },
      }
    }

    return { status: 'COMPLETED' }
  }
}
