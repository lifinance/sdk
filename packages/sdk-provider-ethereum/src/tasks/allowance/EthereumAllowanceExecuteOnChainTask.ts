import {
  BaseStepExecutionTask,
  type TaskContext,
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

/** Allowance sub-task (standard/relayer): execute reset + approval on-chain, wait for tx, set DONE. */
export class EthereumAllowanceExecuteOnChainTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_ALLOWANCE_EXECUTE_ON_CHAIN'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const flow = context.allowanceFlow
    return (
      (context.executionStrategy === 'standard' ||
        context.executionStrategy === 'relayer') &&
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
