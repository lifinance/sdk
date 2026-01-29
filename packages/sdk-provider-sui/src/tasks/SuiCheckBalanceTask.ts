import type { ExecutionTask, TaskContext, TaskResult } from '@lifi/sdk'
import { checkBalance } from '@lifi/sdk'
import type { SuiTaskExtra } from './types.js'

export class SuiCheckBalanceTask implements ExecutionTask<SuiTaskExtra, void> {
  readonly type = 'SUI_CHECK_BALANCE'
  readonly displayName = 'Check balance'

  async shouldRun(context: TaskContext<SuiTaskExtra>): Promise<boolean> {
    const { action } = context.extra
    // Once a tx is broadcasted, balance is no longer relevant for this step
    if (action.txHash) {
      return false
    }
    return action.status !== 'DONE'
  }

  async execute(context: TaskContext<SuiTaskExtra>): Promise<TaskResult<void>> {
    const { client, step } = context
    await checkBalance(client, step.action.fromAddress!, step)
    return { status: 'COMPLETED' }
  }
}
