import {
  BaseStepExecutionTask,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { getAllowance } from '../../actions/getAllowance.js'
import {
  applyAllowanceResultToContext,
  getPermit2Supported,
  isAllowanceStrategy,
  shouldRunAllowanceCheck,
} from '../helpers/allowanceTaskHelpers.js'
import type { AllowanceFlowState } from '../helpers/allowanceTypes.js'
import type { EthereumTaskExtra } from '../types.js'

/** Allowance sub-task: compute spender, fromAmount, approved; set DONE if already approved. */
export class EthereumAllowanceGetSpenderTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_ALLOWANCE_GET_SPENDER'

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
    context.statusManager.updateAction(
      context.step,
      flow.sharedAction!.type,
      'STARTED'
    )
    const permit2Supported = getPermit2Supported(context)
    const spenderAddress = (
      permit2Supported
        ? context.fromChain.permit2
        : context.step.estimate.approvalAddress
    ) as Address
    const fromAmount = BigInt(context.step.action.fromAmount)
    const approved = await getAllowance(
      context.client,
      flow.updatedClient!,
      context.step.action.fromToken.address as Address,
      flow.updatedClient!.account!.address,
      spenderAddress
    )
    flow.spenderAddress = spenderAddress
    flow.fromAmount = fromAmount
    flow.approved = approved

    if (fromAmount <= approved) {
      context.statusManager.updateAction(
        context.step,
        flow.sharedAction!.type,
        'DONE'
      )
      const result = {
        status: 'DONE' as const,
        data: flow.signedTypedData ?? [],
      }
      flow.result = result
      applyAllowanceResultToContext(context, result)
    }
    return { status: 'COMPLETED', data: { allowanceFlow: flow } }
  }
}
