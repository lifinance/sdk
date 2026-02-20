import {
  BaseStepExecutionTask,
  type ExecutionAction,
  isTransactionPrepared,
  type TaskResult,
} from '@lifi/sdk'
import type { SolanaStepExecutorContext } from '../../types.js'
import { shouldUseJitoBundle } from '../../utils/shouldUseJitoBundle.js'
import { SolanaJitoWaitForTransactionTask } from './SolanaJitoWaitForTransactionTask.js'
import { SolanaStandardWaitForTransactionTask } from './SolanaStandardWaitForTransactionTask.js'

export class SolanaWaitForTransactionTask extends BaseStepExecutionTask {
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

  override async shouldRun(
    _context: SolanaStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return isTransactionPrepared(action)
  }

  async run(
    context: SolanaStepExecutorContext,
    action: ExecutionAction
  ): Promise<TaskResult> {
    const { client, signedTransactions } = context

    const useJitoBundle = shouldUseJitoBundle(
      client.config.routeOptions,
      signedTransactions
    )

    if (useJitoBundle) {
      return this.strategies.jito.run(context, action)
    }
    return this.strategies.standard.run(context, action)
  }
}
