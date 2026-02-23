import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import type { StepExecutorContext, TaskResult } from '../../types/execution.js'
import { BaseStepExecutionTask } from '../BaseStepExecutionTask.js'
import { checkBalance } from './helpers/checkBalance.js'

export class CheckBalanceTask extends BaseStepExecutionTask {
  static override readonly name = 'CHECK_BALANCE' as const
  override readonly taskName = CheckBalanceTask.name

  async run(context: StepExecutorContext): Promise<TaskResult> {
    const { client, step, statusManager, isBridgeExecution } = context

    statusManager.findOrCreateAction({
      step,
      type: isBridgeExecution ? 'CROSS_CHAIN' : 'SWAP',
      chainId: step.action.fromChainId,
    })

    const walletAddress = step.action.fromAddress
    if (!walletAddress) {
      throw new TransactionError(
        LiFiErrorCode.InternalError,
        'The wallet address is undefined.'
      )
    }

    await checkBalance(client, walletAddress, step)
    return { status: 'COMPLETED' }
  }
}
