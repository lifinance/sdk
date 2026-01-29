import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import type { EthereumTaskExtra } from './types.js'

export class EthereumStartActionTask
  implements ExecutionTask<EthereumTaskExtra, void>
{
  readonly type = 'ETHEREUM_START_ACTION'
  readonly displayName = 'Start action'

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    const { action } = context.extra
    if (action.txHash) {
      return false
    }
    return action.status !== 'DONE'
  }

  async execute(
    _context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    // Action is already findOrCreateAction(STARTED) by executor before pipeline
    return { status: 'COMPLETED' }
  }
}
