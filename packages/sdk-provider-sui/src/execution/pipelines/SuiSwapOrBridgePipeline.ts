import {
  CheckBalanceTask,
  PrepareTransactionTask,
  TaskPipeline,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { SuiSignAndExecuteTask } from '../tasks/SuiSignAndExecuteTask.js'
import { SuiWaitForTransactionTask } from '../tasks/SuiWaitForTransactionTask.js'

export class SuiSwapOrBridgePipeline extends TaskPipeline {
  constructor(isBridgeExecution: boolean) {
    const swapOrBridgeActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    super(swapOrBridgeActionType, [
      new CheckBalanceTask(),
      new PrepareTransactionTask(),
      new SuiSignAndExecuteTask(),
      new SuiWaitForTransactionTask(),
      new WaitForTransactionStatusTask(),
    ])
  }
}
