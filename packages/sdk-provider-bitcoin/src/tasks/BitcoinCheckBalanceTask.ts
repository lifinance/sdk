import type { TaskContext, TaskResult } from '@lifi/sdk'
import { checkBalance } from '@lifi/sdk'
import { BitcoinStepExecutionTask } from './BitcoinStepExecutionTask.js'
import type { BitcoinTaskExtra } from './types.js'

export class BitcoinCheckBalanceTask extends BitcoinStepExecutionTask<void> {
  readonly type = 'BITCOIN_CHECK_BALANCE'

  override async shouldRun(
    context: TaskContext<BitcoinTaskExtra>
  ): Promise<boolean> {
    const { action } = context
    return !action.txHash && action.status !== 'DONE'
  }

  protected override async run(
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
