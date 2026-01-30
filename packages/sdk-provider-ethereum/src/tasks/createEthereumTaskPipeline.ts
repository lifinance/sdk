import type { ExecutionTask } from '@lifi/sdk'
import { EthereumCheckAllowanceTask } from './EthereumCheckAllowanceTask.js'
import { EthereumCheckBalanceTask } from './EthereumCheckBalanceTask.js'
import { EthereumDestinationChainCheckTask } from './EthereumDestinationChainCheckTask.js'
import { EthereumPrepareTransactionTask } from './EthereumPrepareTransactionTask.js'
import { EthereumSignAndExecuteTask } from './EthereumSignAndExecuteTask.js'
import { EthereumWaitForTransactionTask } from './EthereumWaitForTransactionTask.js'

export function createEthereumTaskPipeline(): ExecutionTask[] {
  return [
    new EthereumDestinationChainCheckTask(),
    new EthereumCheckAllowanceTask(),
    new EthereumCheckBalanceTask(),
    new EthereumPrepareTransactionTask(),
    new EthereumSignAndExecuteTask(),
    new EthereumWaitForTransactionTask(),
  ]
}
