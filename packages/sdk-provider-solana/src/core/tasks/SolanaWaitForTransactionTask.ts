import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { SolanaStepExecutorContext } from '../../types.js'
import { shouldUseJitoBundle } from '../../utils/shouldUseJitoBundle.js'
import { SolanaJitoWaitForTransactionTask } from './SolanaJitoWaitForTransactionTask.js'
import { SolanaStandardWaitForTransactionTask } from './SolanaStandardWaitForTransactionTask.js'

export class SolanaWaitForTransactionTask extends BaseStepExecutionTask {
  async run(context: SolanaStepExecutorContext): Promise<TaskResult> {
    const { client, signedTransactions: contextSignedTransactions } = context

    const signedTransactions = contextSignedTransactions ?? []

    const useJitoBundle = shouldUseJitoBundle(
      client.config.routeOptions,
      signedTransactions
    )

    if (useJitoBundle) {
      return new SolanaJitoWaitForTransactionTask().run(context)
    }
    return new SolanaStandardWaitForTransactionTask().run(context)
  }
}
