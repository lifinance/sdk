import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskResult,
} from '@lifi/sdk'
import { getTransactionCodec, type Transaction } from '@solana/kit'
import type { SolanaSignTransactionOutput } from '@solana/wallet-standard-features'
import type { SolanaStepExecutorContext } from '../types.js'
import { shouldUseJitoBundle } from '../utils/shouldUseJitoBundle.js'
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
    context: SolanaStepExecutorContext,
    action: ExecutionAction
  ): Promise<boolean> {
    return !context.isTransactionExecuted(action)
  }

  async run(
    context: SolanaStepExecutorContext,
    action: ExecutionAction,
    payload: {
      signedTransactionOutputs: SolanaSignTransactionOutput[]
    }
  ): Promise<TaskResult> {
    const { client } = context
    const { signedTransactionOutputs } = payload

    const transactionCodec = getTransactionCodec()

    // Decode all signed transactions
    const signedTransactions: Transaction[] = signedTransactionOutputs.map(
      (output) => transactionCodec.decode(output.signedTransaction)
    )

    const useJitoBundle = shouldUseJitoBundle(
      client.config.routeOptions,
      signedTransactions
    )

    if (useJitoBundle) {
      return this.strategies.jito.run(context, action, {
        signedTransactions,
      })
    }
    return this.strategies.standard.run(context, action, {
      signedTransactions,
    })
  }
}
