import {
  CheckBalanceTask,
  PrepareTransactionTask,
  TaskPipeline,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { BitcoinSignAndExecuteTask } from '../tasks/BitcoinSignAndExecuteTask.js'
import { BitcoinWaitForTransactionTask } from '../tasks/BitcoinWaitForTransactionTask.js'

export class BitcoinSwapOrBridgePipeline extends TaskPipeline {
  constructor(isBridgeExecution: boolean) {
    const swapOrBridgeActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    super(swapOrBridgeActionType, [
      new CheckBalanceTask(),
      new PrepareTransactionTask(),
      new BitcoinSignAndExecuteTask(),
      new BitcoinWaitForTransactionTask(),
      new WaitForTransactionStatusTask(),
    ])
  }
}
