import { LiFiErrorCode } from '../../errors/constants.js'
import { TransactionError } from '../../errors/errors.js'
import type { StepExecutorContext, TaskResult } from '../../types/execution.js'
import { BaseStepExecutionTask } from '../BaseStepExecutionTask.js'
import { checkBalance } from './helpers/checkBalance.js'

export class CheckBalanceTask extends BaseStepExecutionTask {
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

    await checkBalance(client, walletAddress, step)
    return { status: 'COMPLETED' }
  }
}
