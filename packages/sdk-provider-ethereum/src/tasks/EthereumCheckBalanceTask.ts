import type { TaskContext, TaskResult } from '@lifi/sdk'
import { checkBalance } from '@lifi/sdk'
import { EthereumStepExecutionTask } from './EthereumStepExecutionTask.js'
import type { EthereumTaskExtra } from './types.js'

export class EthereumCheckBalanceTask extends EthereumStepExecutionTask<void> {
  readonly type = 'ETHEREUM_CHECK_BALANCE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !action.txHash && !action.taskId && action.status !== 'DONE'
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<void>> {
    const { client, step, statusManager, actionType, ethereumClient } = context
    context.action = statusManager.updateAction(step, actionType, 'STARTED')
    await checkBalance(client, ethereumClient.account!.address, step)
    return { status: 'COMPLETED' }
  }
}
