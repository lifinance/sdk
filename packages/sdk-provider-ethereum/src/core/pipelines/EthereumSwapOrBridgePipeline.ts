import {
  CheckBalanceTask,
  TaskPipeline,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { EthereumPrepareTransactionTask } from '../tasks/EthereumPrepareTransactionTask.js'
import { EthereumSignAndExecuteTask } from '../tasks/EthereumSignAndExecuteTask.js'
import { EthereumWaitForTransactionTask } from '../tasks/EthereumWaitForTransactionTask.js'

export class EthereumSwapOrBridgePipeline extends TaskPipeline {
  constructor(isBridgeExecution: boolean) {
    const swapOrBridgeActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    super(swapOrBridgeActionType, [
      new CheckBalanceTask(),
      new EthereumPrepareTransactionTask(),
      new EthereumSignAndExecuteTask(),
      new EthereumWaitForTransactionTask(),
      new WaitForTransactionStatusTask(),
    ])
  }
}
