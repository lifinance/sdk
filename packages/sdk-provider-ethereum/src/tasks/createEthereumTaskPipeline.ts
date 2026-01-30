import type { ExecutionTask } from '@lifi/sdk'
import { EthereumAwaitUserSignatureTask } from './EthereumAwaitUserSignatureTask.js'
import { EthereumCheckAllowanceTask } from './EthereumCheckAllowanceTask.js'
import { EthereumCheckBalanceTask } from './EthereumCheckBalanceTask.js'
import { EthereumDestinationChainCheckTask } from './EthereumDestinationChainCheckTask.js'
import { EthereumPrepareTransactionTask } from './EthereumPrepareTransactionTask.js'
import { EthereumSignAndExecuteTask } from './EthereumSignAndExecuteTask.js'
import { EthereumStartActionTask } from './EthereumStartActionTask.js'
import { EthereumWaitForTransactionTask } from './EthereumWaitForTransactionTask.js'

export function createEthereumTaskPipeline(): ExecutionTask[] {
  return [
    new EthereumDestinationChainCheckTask(),
    new EthereumCheckAllowanceTask(),
    new EthereumStartActionTask(),
    new EthereumCheckBalanceTask(),
    new EthereumPrepareTransactionTask(),
    new EthereumAwaitUserSignatureTask(),
    new EthereumSignAndExecuteTask(),
    new EthereumWaitForTransactionTask(),
  ]
}
