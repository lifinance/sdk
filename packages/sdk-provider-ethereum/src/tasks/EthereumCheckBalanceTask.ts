import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { checkBalance } from '@lifi/sdk'
import type { EthereumTaskExtra } from './types.js'

export class EthereumCheckBalanceTask
  implements ExecutionTask<EthereumTaskExtra, void>
{
  readonly type = 'ETHEREUM_CHECK_BALANCE'
  readonly displayName = 'Check balance'

  async shouldRun(context: TaskContext<EthereumTaskExtra>): Promise<boolean> {
    const { action } = context
    if (action.txHash) {
      return false
    }
    return action.status !== 'DONE'
  }

  async execute(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const { client, step, ethereumClient } = context
    await checkBalance(client, ethereumClient.account!.address, step)
    return { status: 'COMPLETED' }
  }
}
