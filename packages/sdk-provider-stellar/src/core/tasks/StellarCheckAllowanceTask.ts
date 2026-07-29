import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { StellarStepExecutorContext } from '../../types.js'
import { readAllowance } from './helpers/readAllowance.js'
import { resolveApprovalSpender } from './helpers/resolveApprovalSpender.js'

export class StellarCheckAllowanceTask extends BaseStepExecutionTask {
  async run(context: StellarStepExecutorContext): Promise<TaskResult> {
    const {
      step,
      client,
      wallet,
      statusManager,
      networkPassphrase,
      approvalSpenderOverride,
    } = context

    const approvalSpender = resolveApprovalSpender(
      step,
      approvalSpenderOverride
    )

    // No resolvable spender means this step needs no approval at all — skip
    // without creating a CHECK_ALLOWANCE action, so the route history doesn't
    // show an allowance step that never applied.
    if (!approvalSpender) {
      return {
        status: 'COMPLETED',
        context: { approvalSpender: undefined, hasSufficientAllowance: true },
      }
    }

    const action = statusManager.initializeAction({
      step,
      type: 'CHECK_ALLOWANCE',
      chainId: step.action.fromChainId,
      status: 'STARTED',
    })

    const allowance = await readAllowance(
      client,
      step.action.fromToken.address,
      wallet.address,
      approvalSpender,
      networkPassphrase
    )

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
      context: {
        approvalSpender,
        // Read fromAmount here rather than in the executor: CheckBalanceTask can
        // revise it downward on its final-attempt slippage rescue, and it runs
        // before this task.
        hasSufficientAllowance: BigInt(step.action.fromAmount) <= allowance,
      },
    }
  }
}
