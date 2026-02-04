import {
  BaseStepExecutionTask,
  checkBalance,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { EthereumTaskExtra } from './types.js'

export class EthereumCheckBalanceTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  void
> {
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
