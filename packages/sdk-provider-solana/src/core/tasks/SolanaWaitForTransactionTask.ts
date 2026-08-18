import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { SolanaStepExecutorContext } from '../../types.js'
import { SolanaJitoWaitForTransactionTask } from './SolanaJitoWaitForTransactionTask.js'
import { SolanaStandardWaitForTransactionTask } from './SolanaStandardWaitForTransactionTask.js'

export class SolanaWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: SolanaStepExecutorContext): Promise<TaskResult> {
    // The submission method is determined by the shape of the backend's
    // `transactionRequest.data` (resolved in SolanaSignAndExecuteTask):
    // a bundle (array) must go through `sendBundle`, a single transaction
    // (string) through `sendTransaction`.
    if (context.isBundleExecution) {
      return new SolanaJitoWaitForTransactionTask().run(context)
    }
    return new SolanaStandardWaitForTransactionTask().run(context)
  }
}
