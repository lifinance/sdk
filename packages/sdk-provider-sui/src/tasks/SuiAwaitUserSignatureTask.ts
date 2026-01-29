import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import type { SuiTaskExtra } from './types.js'

export class SuiAwaitUserSignatureTask
  implements ExecutionTask<SuiTaskExtra, void>
{
  readonly type = 'SUI_AWAIT_SIGNATURE'
  readonly displayName = 'Sign transaction'

  async shouldRun(context: TaskContext<SuiTaskExtra>): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  async execute(context: TaskContext<SuiTaskExtra>): Promise<TaskResult<void>> {
    const { step, statusManager, actionType, allowUserInteraction } = context

    context.action = statusManager.updateAction(
      step,
      actionType,
      'ACTION_REQUIRED'
    )

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    return { status: 'COMPLETED' }
  }
}
