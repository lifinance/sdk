import { BaseStepExecutionTask, type TaskResult } from '@lifi/sdk'
import type { StellarStepExecutorContext } from '../../types.js'
import { readAllowance } from './helpers/readAllowance.js'
import { resolveApprovalRequirement } from './helpers/resolveApprovalRequirement.js'

export class StellarCheckAllowanceTask extends BaseStepExecutionTask {
  async run(context: StellarStepExecutorContext): Promise<TaskResult> {
    const { step, client, wallet, statusManager, networkPassphrase } = context

    // Resolved at run time, not when the pipeline is built — an earlier task may
    // have revised the step.
    const approval = resolveApprovalRequirement(step)

    // No included leg declares an allowance, so this step needs none — skip
    // without creating a CHECK_ALLOWANCE action, so the route history doesn't
    // show an allowance step that never applied.
    if (!approval) {
      return {
        status: 'COMPLETED',
        context: { approval: undefined, hasSufficientAllowance: true },
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
      approval.tokenAddress,
      wallet.address,
      approval.spender,
      networkPassphrase
    )

    statusManager.updateAction(step, action.type, 'DONE')

    return {
      status: 'COMPLETED',
      context: {
        approval,
        hasSufficientAllowance: approval.amount <= allowance,
      },
    }
  }
}
