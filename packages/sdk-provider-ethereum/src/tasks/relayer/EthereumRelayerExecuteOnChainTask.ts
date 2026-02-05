import {
  BaseStepExecutionTask,
  type ExecutionAction,
  type TaskContext,
  type TaskExecutionActionType,
  type TaskResult,
} from '@lifi/sdk'
import type { Hash } from 'viem'
import { setAllowance } from '../../actions/setAllowance.js'
import { MaxUint256 } from '../../permits/constants.js'
import {
  applyAllowanceResultToContext,
  getAllowanceParams,
  getPermit2Supported,
  shouldRunAllowanceCheck,
} from '../helpers/allowanceTaskHelpers.js'
import type { AllowanceFlowState } from '../helpers/allowanceTypes.js'
import { waitForApprovalTransaction } from '../helpers/waitForApprovalTransaction.js'
import type { EthereumTaskExtra } from '../types.js'

export class EthereumRelayerExecuteOnChainTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_RELAYER_EXECUTE_ON_CHAIN'
  readonly actionType: TaskExecutionActionType = 'TOKEN_ALLOWANCE'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>,
    _action?: ExecutionAction
  ): Promise<boolean> {
    const flow = context.allowanceFlow
    return (
      context.executionStrategy === 'relayer' &&
      shouldRunAllowanceCheck(context, _action) &&
      !flow?.result &&
      flow?.shouldResetApproval !== undefined &&
      !!context.allowUserInteraction
    )
  }

  protected async run(
    context: TaskContext<EthereumTaskExtra>,
    _action: ExecutionAction
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
        false
      )
      await waitForApprovalTransaction(
        context.client,
        flow.updatedClient!,
        approvalResetTxHash,
        flow.sharedAction!.type,
        context.step,
        params.chain,
        context.statusManager
      )
      context.statusManager.updateAction(
        context.step,
        flow.sharedAction!.type,
        'ACTION_REQUIRED',
        { txHash: undefined, txLink: undefined }
      )
      if (!(params.allowUserInteraction ?? false)) {
        flow.result = { status: 'ACTION_REQUIRED' }
        applyAllowanceResultToContext(context, flow.result)
        return { status: 'PAUSED', data: { allowanceFlow: flow } }
      }
    }
    const approveAmount = permit2Supported ? MaxUint256 : fromAmount
    const approveTxHash = await setAllowance(
      context.client,
      flow.updatedClient!,
      tokenAddress,
      spenderAddress,
      approveAmount,
      params.executionOptions,
      false
    )
    await waitForApprovalTransaction(
      context.client,
      flow.updatedClient!,
      approveTxHash,
      flow.sharedAction!.type,
      context.step,
      params.chain,
      context.statusManager
    )
    const result = { status: 'DONE' as const, data: signedTypedData }
    flow.result = result
    applyAllowanceResultToContext(context, result)
    return { status: 'COMPLETED', data: { allowanceFlow: flow } }
  }
}
