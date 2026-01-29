import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import type { EthereumTaskExtra } from './types.js'

export class EthereumStartActionTask
  implements ExecutionTask<EthereumTaskExtra, void>
{
  readonly type = 'ETHEREUM_START_ACTION'
  readonly displayName = 'Start action'

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    const { action } = context
    return !action.txHash && !action.taskId && action.status !== 'DONE'
  }

  async execute(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const { step, statusManager, actionType } = context
    context.action = statusManager.updateAction(step, actionType, 'STARTED')
    return { status: 'COMPLETED' }
  }
}
