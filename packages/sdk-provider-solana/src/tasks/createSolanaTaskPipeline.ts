import type { ExecutionTask } from '@lifi/sdk'
import { SolanaCheckBalanceTask } from './SolanaCheckBalanceTask.js'
import { SolanaPrepareTransactionTask } from './SolanaPrepareTransactionTask.js'
import { SolanaSignAndExecuteTask } from './SolanaSignAndExecuteTask.js'
import { SolanaWaitForTransactionTask } from './SolanaWaitForTransactionTask.js'

export function createSolanaTaskPipeline(): ExecutionTask[] {
  return [
    new SolanaCheckBalanceTask(),
    new SolanaPrepareTransactionTask(),
    new SolanaSignAndExecuteTask(),
    new SolanaWaitForTransactionTask(),
  ]
}
