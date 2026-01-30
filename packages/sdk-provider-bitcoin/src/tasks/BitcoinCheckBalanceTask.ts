import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { checkBalance } from '@lifi/sdk'
import type { BitcoinTaskExtra } from './types.js'

export class BitcoinCheckBalanceTask
  implements ExecutionTask<BitcoinTaskExtra, void>
{
  readonly type = 'BITCOIN_CHECK_BALANCE'
  readonly displayName = 'Check balance'

  async shouldRun(context: TaskContext<BitcoinTaskExtra>): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  async execute(
    context: TaskContext<BitcoinTaskExtra>
  ): Promise<TaskResult<void>> {
    const { client, step, statusManager, actionType, walletClient } = context

    if (!walletClient.account?.address) {
      throw new Error('Wallet account is not available.')
    }

    context.action = statusManager.updateAction(step, actionType, 'STARTED')
    await checkBalance(client, walletClient.account.address, step)
    return { status: 'COMPLETED' }
  }
}
