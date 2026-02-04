import {
  BaseStepExecutionTask,
  type SignedTypedData,
  type TaskContext,
  type TaskResult,
} from '@lifi/sdk'
import type { Address } from 'viem'
import { signTypedData } from 'viem/actions'
import { getAction } from 'viem/utils'
import { getNativePermit } from '../../permits/getNativePermit.js'
import { isNativePermitValid } from '../../permits/isNativePermitValid.js'
import { getActionWithFallback } from '../../utils/getActionWithFallback.js'
import {
  applyAllowanceResultToContext,
  getAllowanceParams,
  shouldRunAllowanceCheck,
} from '../helpers/allowanceTaskHelpers.js'
import type { AllowanceFlowState } from '../helpers/allowanceTypes.js'
import type { EthereumTaskExtra } from '../types.js'

/** Allowance sub-task (standard/relayer): try native permit; set result or continue. */
export class EthereumAllowanceTryNativePermitTask extends BaseStepExecutionTask<
  EthereumTaskExtra,
  { allowanceFlow: AllowanceFlowState }
> {
  readonly type = 'ETHEREUM_ALLOWANCE_TRY_NATIVE_PERMIT'

  override async shouldRun(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<boolean> {
    const flow = context.allowanceFlow
    return (
      (context.executionStrategy === 'standard' ||
        context.executionStrategy === 'relayer') &&
      shouldRunAllowanceCheck(context) &&
      !flow?.result &&
      flow?.spenderAddress !== undefined &&
      flow?.fromAmount !== undefined
    )
  }

  protected override async run(
    context: TaskContext<EthereumTaskExtra>
  ): Promise<TaskResult<{ allowanceFlow: AllowanceFlowState }>> {
    const flow = context.allowanceFlow!
    const params = getAllowanceParams(context)
    const signedTypedData = flow.signedTypedData ?? []
    const allowUserInteraction = params.allowUserInteraction ?? false
    const disableMessageSigning = params.disableMessageSigning ?? false
    const isNativePermitAvailable =
      !!params.chain.permit2Proxy &&
      !disableMessageSigning &&
      !context.step.estimate.skipPermit
    if (!isNativePermitAvailable) {
      return { status: 'COMPLETED', data: { allowanceFlow: flow } }
    }
    const nativePermitData = await getActionWithFallback(
      context.client,
      flow.updatedClient!,
      getNativePermit,
      'getNativePermit',
      {
        client: context.client,
        viemClient: flow.updatedClient!,
        chainId: params.chain.id,
        tokenAddress: context.step.action.fromToken.address as Address,
        spenderAddress: params.chain.permit2Proxy as Address,
        amount: flow.fromAmount!,
      }
    )
    if (!nativePermitData) {
      return { status: 'COMPLETED', data: { allowanceFlow: flow } }
    }
    let currentSigned =
      signedTypedData.length > 0
        ? signedTypedData
        : flow.sharedAction!.signedTypedData || []
    const validPermit = currentSigned.find((s: SignedTypedData) =>
      isNativePermitValid(s, nativePermitData!)
    )
    if (!validPermit) {
      context.statusManager.updateAction(
        context.step,
        flow.sharedAction!.type,
        'ACTION_REQUIRED'
      )
      if (!allowUserInteraction) {
        flow.result = { status: 'ACTION_REQUIRED' }
        applyAllowanceResultToContext(context, flow.result)
        return { status: 'PAUSED', data: { allowanceFlow: flow } }
      }
      const signature = await getAction(
        flow.updatedClient!,
        signTypedData,
        'signTypedData'
      )({
        account: flow.updatedClient!.account!,
        domain: nativePermitData.domain,
        types: nativePermitData.types,
        primaryType: nativePermitData.primaryType,
        message: nativePermitData.message,
      })
      const signedPermit: SignedTypedData = {
        ...nativePermitData,
        signature,
      }
      currentSigned = [...currentSigned, signedPermit]
    }
    context.statusManager.updateAction(
      context.step,
      flow.sharedAction!.type,
      'DONE',
      { signedTypedData: currentSigned }
    )
    const nativeResult = {
      status: 'NATIVE_PERMIT' as const,
      data: currentSigned,
    }
    flow.result = nativeResult
    applyAllowanceResultToContext(context, nativeResult)
    return { status: 'COMPLETED', data: { allowanceFlow: flow } }
  }
}
