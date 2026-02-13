import {
  CheckBalanceTask,
  PrepareTransactionTask,
  TaskPipeline,
  WaitForTransactionStatusTask,
} from '@lifi/sdk'
import { SolanaSignAndExecuteTask } from '../tasks/SolanaSignAndExecuteTask.js'
import { SolanaWaitForTransactionTask } from '../tasks/SolanaWaitForTransactionTask.js'

export class SolanaSwapOrBridgePipeline extends TaskPipeline {
  constructor(isBridgeExecution: boolean) {
    const swapOrBridgeActionType = isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
    super(swapOrBridgeActionType, [
      new CheckBalanceTask(),
      new PrepareTransactionTask(),
      new SolanaSignAndExecuteTask(),
      new SolanaWaitForTransactionTask(),
      new WaitForTransactionStatusTask(),
    ])
  }
}
