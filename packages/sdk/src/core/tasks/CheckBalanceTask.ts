import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import type { StepExecutorContext, TaskResult } from '../../types/execution.js'
import { BaseStepExecutionTask } from '../BaseStepExecutionTask.js'
import {
  type CheckBalanceOptions,
  checkBalance,
} from './helpers/checkBalance.js'

export class CheckBalanceTask extends BaseStepExecutionTask {
  /**
   * Per-step options hook for chain-specific subclasses (e.g. skip the
   * gas check for smart-contract wallets or relayed steps). Default `{}`
   * keeps behavior unchanged for every provider that doesn't override.
   * Resolved lazily inside `run()` — pipelines that resume past
   * `CheckBalance` pay no cost.
   */
  protected getCheckBalanceOptions(
    _context: StepExecutorContext
  ): Promise<CheckBalanceOptions> {
    return Promise.resolve({})
  }

  async run(context: StepExecutorContext): Promise<TaskResult> {
    const { client, step, statusManager, isBridgeExecution } = context

    statusManager.initializeAction({
      step,
      type: isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

    const walletAddress = step.action.fromAddress
    if (!walletAddress) {
      throw new TransactionError(
        LiFiErrorCode.InternalError,
        'The wallet address is undefined.'
      )
    }

    const options = await this.getCheckBalanceOptions(context)
    await checkBalance(client, walletAddress, step, options)
    return { status: 'COMPLETED' }
  }
}
