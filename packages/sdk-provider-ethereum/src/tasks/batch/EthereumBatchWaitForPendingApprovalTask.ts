import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskExecutionActionType,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import {
  applyAllowanceResultToContext,
  getAllowanceParams,
  shouldRunAllowanceCheck,
} from '../helpers/allowanceTaskHelpers.js'
import type { AllowanceFlowState } from '../helpers/allowanceTypes.js'
import { waitForApprovalTransaction } from '../helpers/waitForApprovalTransaction.js'
import type { EthereumTaskExtra } from '../types.js'

export class EthereumBatchWaitForPendingApprovalTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_BATCH_WAIT_FOR_PENDING_APPROVAL'
  readonly actionType: TaskExecutionActionType = 'TOKEN_ALLOWANCE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    _action?: ExecutionAction
  ): Promise<boolean> {
    return (
      context.executionStrategy === 'batch' &&
      shouldRunAllowanceCheck(context, _action) &&
      !context.allowanceFlow?.result &&
      !!context.allowanceFlow?.updatedClient
    )
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    _action: ExecutionAction
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
