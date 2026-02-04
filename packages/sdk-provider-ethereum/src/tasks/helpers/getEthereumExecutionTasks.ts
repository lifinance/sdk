import type { BaseStepExecutionTask } from '@lifi/sdk'
import { EthereumCheckAllowanceBatchTask } from '../EthereumCheckAllowanceBatchTask.js'
import { EthereumCheckAllowanceRelayerTask } from '../EthereumCheckAllowanceRelayerTask.js'
import { EthereumCheckAllowanceStandardTask } from '../EthereumCheckAllowanceStandardTask.js'
import { EthereumCheckBalanceTask } from '../EthereumCheckBalanceTask.js'
import { EthereumDestinationChainCheckTask } from '../EthereumDestinationChainCheckTask.js'
import { EthereumPrepareTransactionTask } from '../EthereumPrepareTransactionTask.js'
import { EthereumSignAndExecuteBatchTask } from '../EthereumSignAndExecuteBatchTask.js'
import { EthereumSignAndExecuteRelayerTask } from '../EthereumSignAndExecuteRelayerTask.js'
import { EthereumSignAndExecuteStandardTask } from '../EthereumSignAndExecuteStandardTask.js'
import { EthereumWaitForDestinationChainTask } from '../EthereumWaitForDestinationChainTask.js'
import { EthereumWaitForTransactionTask } from '../EthereumWaitForTransactionTask.js'
import type { EthereumExecutionStrategy, EthereumTaskExtra } from '../types.js'

export function getEthereumExecutionTasks(
  executionStrategy: EthereumExecutionStrategy
): BaseStepExecutionTask<EthereumTaskExtra, unknown>[] {
  if (executionStrategy === 'relayer') {
    return [
      new EthereumDestinationChainCheckTask(),
      new EthereumCheckAllowanceRelayerTask(),
      new EthereumCheckBalanceTask(),
      new EthereumPrepareTransactionTask(),
      new EthereumSignAndExecuteRelayerTask(),
      new EthereumWaitForTransactionTask(),
      new EthereumWaitForDestinationChainTask(),
    ]
  }
  if (executionStrategy === 'batch') {
    return [
      new EthereumDestinationChainCheckTask(),
      new EthereumCheckAllowanceBatchTask(),
      new EthereumCheckBalanceTask(),
      new EthereumPrepareTransactionTask(),
      new EthereumSignAndExecuteBatchTask(),
      new EthereumWaitForTransactionTask(),
      new EthereumWaitForDestinationChainTask(),
    ]
  }
  return [
    new EthereumDestinationChainCheckTask(),
    new EthereumCheckAllowanceStandardTask(),
    new EthereumCheckBalanceTask(),
    new EthereumPrepareTransactionTask(),
    new EthereumSignAndExecuteStandardTask(),
    new EthereumWaitForTransactionTask(),
    new EthereumWaitForDestinationChainTask(),
  ]
}
