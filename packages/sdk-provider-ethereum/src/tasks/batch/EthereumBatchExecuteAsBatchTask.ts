import {
  BaseStepExecutionTask,
  type ExecutionActionType,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Address, Hash } from 'viem'
import { setAllowance } from '../../actions/setAllowance.js'
import { MaxUint256 } from '../../permits/constants.js'
import type { Call } from '../../types.js'
import {
  applyAllowanceResultToContext,
  getAllowanceParams,
  getPermit2Supported,
  shouldRunAllowanceCheck,
} from '../helpers/allowanceTaskHelpers.js'
import type { AllowanceFlowState } from '../helpers/allowanceTypes.js'
import type { EthereumTaskExtra } from '../types.js'

export class EthereumBatchExecuteAsBatchTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_BATCH_EXECUTE_AS_BATCH'
  readonly actionType: ExecutionActionType = 'TOKEN_ALLOWANCE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const flow = context.allowanceFlow
    return (
      context.executionStrategy === 'batch' &&
      shouldRunAllowanceCheck(context) &&
      !flow?.result &&
      flow?.shouldResetApproval !== undefined &&
      !!context.allowUserInteraction
    )
  }

  protected override async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<{ allowanceFlow: AllowanceFlowState }>> {
    const flow = context.allowanceFlow!
    const params = getAllowanceParams(context)
    const signedTypedData = flow.signedTypedData ?? []
    const permit2Supported = getPermit2Supported(context)
    const shouldResetApproval = !!flow.shouldResetApproval
    const spenderAddress = flow.spenderAddress!
    const fromAmount = flow.fromAmount!
    const tokenAddress = context.step.action.fromToken
      .address as import('viem').Address

    let approvalResetTxHash: Hash | undefined
    if (shouldResetApproval) {
      approvalResetTxHash = await setAllowance(
        context.client,
        flow.updatedClient!,
        tokenAddress,
        spenderAddress,
        0n,
        params.executionOptions,
        true
      )
    }
    const approveAmount = permit2Supported ? MaxUint256 : fromAmount
    const approveTxHash = await setAllowance(
      context.client,
      flow.updatedClient!,
      tokenAddress,
      spenderAddress,
      approveAmount,
      params.executionOptions,
      true
    )
    context.statusManager.updateAction(
      context.step,
      flow.sharedAction!.type,
      'DONE'
    )
    const calls: Call[] = []
    if (shouldResetApproval && approvalResetTxHash) {
      calls.push({
        to: context.step.action.fromToken.address as Address,
        data: approvalResetTxHash,
        chainId: context.step.action.fromToken.chainId,
      })
    }
    calls.push({
      to: context.step.action.fromToken.address as Address,
      data: approveTxHash as Hash,
      chainId: context.step.action.fromToken.chainId,
    })
    const result = {
      status: 'BATCH_APPROVAL' as const,
      data: { calls, signedTypedData },
    }
    flow.result = result
    applyAllowanceResultToContext(context, result)
    return { status: 'COMPLETED', data: { allowanceFlow: flow } }
  }
}
