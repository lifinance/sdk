import {
  BaseStepExecutionTask,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import {
  applyAllowanceResultToContext,
  getAllowanceParams,
  isAllowanceStrategy,
  shouldRunAllowanceCheck,
} from '../helpers/allowanceTaskHelpers.js'
import type { AllowanceFlowState } from '../helpers/allowanceTypes.js'
import { waitForApprovalTransaction } from '../helpers/waitForApprovalTransaction.js'
import type { EthereumTaskExtra } from '../types.js'

/** Allowance sub-task: if action has pending tx, wait for it and set DONE. */
export class EthereumAllowanceWaitForPendingApprovalTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_ALLOWANCE_WAIT_FOR_PENDING_APPROVAL'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    return (
      isAllowanceStrategy(context) &&
      shouldRunAllowanceCheck(context) &&
      !context.allowanceFlow?.result &&
      !!context.allowanceFlow?.updatedClient
    )
  }

  protected override async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<{ allowanceFlow: AllowanceFlowState }>> {
    const flow = context.allowanceFlow!
    const params = getAllowanceParams(context)
    const signedTypedData = flow.signedTypedData ?? []
    let pendingResult: { status: 'DONE'; data: typeof signedTypedData } | null =
      null
    if (flow.sharedAction!.txHash && flow.sharedAction!.status !== 'DONE') {
      await waitForApprovalTransaction(
        context.client,
        flow.updatedClient!,
        flow.sharedAction!.txHash as Address,
        flow.sharedAction!.type,
        context.step,
        params.chain,
        context.statusManager
      )
      pendingResult = { status: 'DONE', data: signedTypedData }
    }
    if (pendingResult) {
      flow.result = pendingResult
      applyAllowanceResultToContext(context, pendingResult)
    }
    return { status: 'COMPLETED', data: { allowanceFlow: flow } }
  }
}
