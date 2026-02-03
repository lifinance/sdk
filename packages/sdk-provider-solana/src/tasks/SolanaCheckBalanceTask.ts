import type { TaskContext, TaskResult } from '@lifi/sdk'
import { checkBalance } from '@lifi/sdk'
import { SolanaStepExecutionTask } from './SolanaStepExecutionTask.js'
import type { SolanaTaskExtra } from './types.js'

export class SolanaCheckBalanceTask extends SolanaStepExecutionTask<void> {
  readonly type = 'SOLANA_CHECK_BALANCE'

  override async shouldRun(
    context: TaskContext<SolanaTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  protected override async run(
    context: TaskContext<SolanaTaskExtra>
  ): Promise<TaskResult<void>> {
    const { client, step, statusManager, actionType, walletAccount } = context
    context.action = statusManager.updateAction(step, actionType, 'STARTED')
    await checkBalance(client, walletAccount.address, step)
    return { status: 'COMPLETED' }
  }
}
