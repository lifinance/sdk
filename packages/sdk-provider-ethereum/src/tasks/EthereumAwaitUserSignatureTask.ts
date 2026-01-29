import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import type { EthereumTaskExtra } from './types.js'

export class EthereumAwaitUserSignatureTask
  implements ExecutionTask<EthereumTaskExtra, void>
{
  readonly type = 'ETHEREUM_AWAIT_SIGNATURE'
  readonly displayName = 'Sign transaction'

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    const { action } = context
    return !action.txHash && !action.taskId && action.status !== 'DONE'
  }

  async execute(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const { step, statusManager, action, allowUserInteraction } = context

    context.action = statusManager.updateAction(
      step,
      action.type,
      'ACTION_REQUIRED'
    )

    if (!allowUserInteraction) {
      return { status: 'PAUSED' }
    }

    return { status: 'COMPLETED' }
  }
}
