import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { SolanaStepExecutorContext } from '../../types.js'
import { isStoredBundle } from '../../utils/storedTransactions.js'
import { SolanaJitoWaitForTransactionTask } from './SolanaJitoWaitForTransactionTask.js'
import { SolanaStandardWaitForTransactionTask } from './SolanaStandardWaitForTransactionTask.js'

/**
 * On a resume the sign task did not run, so the flag is missing and the
 * stored bytes keep the shape instead: a leading `[` marks a bundle. With a
 * `txHash` alone the standard task looks the signature up, which works for a
 * bundle's first signature too.
 */
function isBundleExecution(context: SolanaStepExecutorContext): boolean {
  if (context.isBundleExecution !== undefined) {
    return context.isBundleExecution
  }
  const action = context.statusManager.findAction(
    context.step,
    context.isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP'
  )
  return action?.txHex ? isStoredBundle(action.txHex) : false
}

export class SolanaWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: SolanaStepExecutorContext): Promise<TaskResult> {
    // The submission method is determined by the shape of the backend's
    // `transactionRequest.data` (resolved in SolanaSignAndExecuteTask):
    // a bundle (array) must go through `sendBundle`, a single transaction
    // (string) through `sendTransaction`.
    if (isBundleExecution(context)) {
      return new SolanaJitoWaitForTransactionTask().run(context)
    }
    return new SolanaStandardWaitForTransactionTask().run(context)
  }
}
