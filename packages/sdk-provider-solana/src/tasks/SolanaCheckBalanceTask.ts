import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { checkBalance } from '@lifi/sdk'
import type { SolanaTaskExtra } from './types.js'

export class SolanaCheckBalanceTask
  implements ExecutionTask<SolanaTaskExtra, void>
{
  readonly type = 'SOLANA_CHECK_BALANCE'
  readonly displayName = 'Check balance'

  async shouldRun(context: TaskContext<SolanaTaskExtra>): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  async execute(
    context: TaskContext<SolanaTaskExtra>
  ): Promise<TaskResult<void>> {
    const { client, step, statusManager, actionType, walletAccount } = context
    context.action = statusManager.updateAction(step, actionType, 'STARTED')
    await checkBalance(client, walletAccount.address, step)
    return { status: 'COMPLETED' }
  }
}
