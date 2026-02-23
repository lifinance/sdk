import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { SolanaStepExecutorContext } from '../../types.js'
import { shouldUseJitoBundle } from '../../utils/shouldUseJitoBundle.js'
import { SolanaJitoWaitForTransactionTask } from './SolanaJitoWaitForTransactionTask.js'
import { SolanaStandardWaitForTransactionTask } from './SolanaStandardWaitForTransactionTask.js'

export class SolanaWaitForTransactionTask extends BaseStepExecutionTask {
  static override readonly name = 'SOLANA_WAIT_FOR_TRANSACTION' as const
  override readonly taskName = SolanaWaitForTransactionTask.name

  private readonly strategies: {
    jito: BaseStepExecutionTask
    standard: BaseStepExecutionTask
  }

  constructor() {
    super()
    this.strategies = {
      jito: new SolanaJitoWaitForTransactionTask(),
      standard: new SolanaStandardWaitForTransactionTask(),
    }
  }

  async run(context: SolanaStepExecutorContext): Promise<TaskResult> {
    const { client, signedTransactions } = context

    const useJitoBundle = shouldUseJitoBundle(
      client.config.routeOptions,
      signedTransactions
    )

    if (useJitoBundle) {
      return this.strategies.jito.run(context)
    }
    return this.strategies.standard.run(context)
  }
}
