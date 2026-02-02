import type { ExecutionTask } from '@lifi/sdk'
import { BitcoinCheckBalanceTask } from './BitcoinCheckBalanceTask.js'
import { BitcoinPrepareTransactionTask } from './BitcoinPrepareTransactionTask.js'
import { BitcoinSignAndExecuteTask } from './BitcoinSignAndExecuteTask.js'
import { BitcoinWaitForTransactionTask } from './BitcoinWaitForTransactionTask.js'

export function createBitcoinTaskPipeline(): ExecutionTask[] {
  return [
    new BitcoinCheckBalanceTask(),
    new BitcoinPrepareTransactionTask(),
    new BitcoinSignAndExecuteTask(),
    new BitcoinWaitForTransactionTask(),
  ]
}
