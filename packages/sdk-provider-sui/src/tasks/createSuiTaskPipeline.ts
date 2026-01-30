import type { ExecutionTask } from '@lifi/sdk'
import { SuiCheckBalanceTask } from './SuiCheckBalanceTask.js'
import { SuiPrepareTransactionTask } from './SuiPrepareTransactionTask.js'
import { SuiSignAndExecuteTask } from './SuiSignAndExecuteTask.js'
import { SuiWaitForTransactionTask } from './SuiWaitForTransactionTask.js'

export function createSuiTaskPipeline(): ExecutionTask[] {
  return [
    new SuiCheckBalanceTask(),
    new SuiPrepareTransactionTask(),
    new SuiSignAndExecuteTask(),
    new SuiWaitForTransactionTask(),
  ]
}
