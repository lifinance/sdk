import type { ExecutionTask } from '@lifi/sdk'
import { SuiAwaitUserSignatureTask } from './SuiAwaitUserSignatureTask.js'
import { SuiCheckBalanceTask } from './SuiCheckBalanceTask.js'
import { SuiPrepareTransactionTask } from './SuiPrepareTransactionTask.js'
import { SuiSignAndExecuteTask } from './SuiSignAndExecuteTask.js'
import { SuiStartActionTask } from './SuiStartActionTask.js'
import { SuiWaitForTransactionTask } from './SuiWaitForTransactionTask.js'

export function createSuiTaskPipeline(): ExecutionTask[] {
  return [
    new SuiStartActionTask(),
    new SuiCheckBalanceTask(),
    new SuiPrepareTransactionTask(),
    new SuiAwaitUserSignatureTask(),
    new SuiSignAndExecuteTask(),
    new SuiWaitForTransactionTask(),
  ]
}
